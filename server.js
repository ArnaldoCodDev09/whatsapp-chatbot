const express = require('express');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
app.use(express.urlencoded({ extended: false }));

// Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Twilio
const twilio = require('twilio');
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

app.post('/webhook', async (req, res) => {
  const from = req.body.From;
  const body = (req.body.Body || "").trim().toLowerCase();

  let responseText = "";

  try {
    // Bienvenida amigable y opciones
    if (body.includes("hola") || body === "1" || body === "menu") {
      responseText = "💊 ¡Hola! Soy tu *botsito farmacéutico*. Bienvenido a la agenda de citas médicas.\n\n" +
        "¿Qué deseas hacer?\n" +
        "1️⃣ Ver horarios disponibles\n" +
        "2️⃣ Ver mis citas confirmadas\n" +
        "3️⃣ Reservar una cita\n\n" +
        "Escribe el número de la opción que elijas.";
    }
    // Mostrar horarios disponibles
    else if (body === "1") {
      const { data, error } = await supabase
        .from('horarios')
        .select('*')
        .eq('disponible', true);
      
      if (error) throw error;
      if (data.length === 0) {
        responseText = "⚠️ No hay horarios disponibles en este momento.";
      } else {
        let lista = "📅 *Horarios disponibles:*\n\n";
        data.forEach((h, index) => {
          lista += `${index + 1}. ${h.dia} ${h.hora}\n`;
        });
        lista += "\nEscribe el *número* del horario que deseas reservar.";
        responseText = lista;
      }
    }
    // Reservar por número (1, 2, 3)
    else if (body === "1" || body === "2" || body === "3") {
      const { data: horarios, error: horError } = await supabase
        .from('horarios')
        .select('*')
        .eq('disponible', true)
        .order('id', { ascending: true });

      if (horError) throw horError;

      const index = parseInt(body) - 1;
      if (index >= 0 && index < horarios.length) {
        const horario = horarios[index];
        const horario_id = horario.id;

        // Marcar como no disponible
        const { error: updateError } = await supabase
          .from('horarios')
          .update({ disponible: false })
          .eq('id', horario_id)
          .eq('disponible', true);

        if (updateError) throw updateError;

        // Verificar que se actualizó
        const { data } = await supabase
          .from('horarios')
          .select('disponible')
          .eq('id', horario_id)
          .single();

        if (data && !data.disponible) {
          await supabase.from('citas').insert({
            usuario: from,
            horario_id: horario_id,
            fecha_confirmacion: new Date().toISOString().split('T')[0]
          });
          responseText = `✅ ¡Cita confirmada!\n\n📅 *${horario.dia} ${horario.hora}*\n\nGracias por confiar en nuestro servicio. ¡Te esperamos!`;
        } else {
          responseText = "⚠️ Ese horario ya fue reservado por otro usuario. Elige otro.";
        }
      } else {
        responseText = "⚠️ Opción no válida. Escribe 1, 2 o 3.";
      }
    }
    // Listar citas confirmadas
    else if (body === "2") {
      const { data, error } = await supabase
        .from('citas')
        .select('horario_id')
        .eq('usuario', from);
      
      if (error) throw error;
      if (data.length === 0) {
        responseText = "📋 Aún no tienes citas confirmadas.";
      } else {
        let lista = "📋 *Tus citas confirmadas:*\n\n";
        data.forEach(c => {
          lista += `• ${c.horario_id}\n`;
        });
        responseText = lista;
      }
    }
    // Opción no reconocida
    else {
      responseText = "💊 ¡Hola! Soy tu *botsito farmacéutico*.\n\nEscribe *hola* o elige una opción:\n1️⃣ Ver horarios\n2️⃣ Ver mis citas\n3️⃣ Reservar cita";
    }

    // Enviar respuesta por WhatsApp
    await twilioClient.messages.create({
      body: responseText,
      from: 'whatsapp:+14155238886',
      to: from
    });

    res.status(200).send('<Response></Response>');
  } catch (error) {
    console.error("Error:", error);
    res.status(500).send('Error');
  }
});

app.get('/', (req, res) => {
  res.send('Chatbot farmacéutico activo ✅');
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});