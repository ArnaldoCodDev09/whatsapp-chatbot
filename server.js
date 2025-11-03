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

// Estado de conversación por usuario (solo en memoria, suficiente para este proyecto)
const userState = new Map();

app.post('/webhook', async (req, res) => {
  const from = req.body.From;
  const body = (req.body.Body || "").trim().toLowerCase();

  let responseText = "";

  try {
    // Siempre mostrar menú si es "hola" o "menu"
    if (body.includes("hola") || body === "menu") {
      responseText = "💊 ¡Hola! Soy tu *botsito farmacéutico*. Bienvenido a la agenda de citas médicas.\n\n" +
        "¿Qué deseas hacer hoy?\n" +
        "1️⃣ Ver horarios disponibles\n" +
        "2️⃣ Ver mis citas confirmadas\n" +
        "3️⃣ Reservar una cita\n\n" +
        "Escribe el número de la opción que elijas.";
      userState.set(from, "menu");
    }
    // Opción 1: Ver horarios
    else if (body === "1") {
      const { data, error } = await supabase
        .from('horarios')
        .select('*')
        .eq('disponible', true);
      
      if (error) throw error;
      if (data.length === 0) {
        responseText = "⚠️ No hay horarios disponibles en este momento.\n\n¿Deseas hacer algo más?\nEscribe *hola* para ver el menú.";
      } else {
        let lista = "📅 *Horarios disponibles:*\n\n";
        data.forEach((h, index) => {
          lista += `${index + 1}. ${h.dia} ${h.hora}\n`;
        });
        lista += "\nEscribe el *número* del horario que deseas reservar.";
        responseText = lista;
        userState.set(from, "reserving");
      }
    }
    // Opción 2: Ver citas
    else if (body === "2") {
      const { data, error } = await supabase
        .from('citas')
        .select('horario_id')
        .eq('usuario', from);
      
      if (error) throw error;
      if (data.length === 0) {
        responseText = "📋 Aún no tienes citas confirmadas.\n\n¿Deseas hacer algo más?\nEscribe *hola* para ver el menú.";
      } else {
        let lista = "📋 *Tus citas confirmadas:*\n\n";
        data.forEach(c => {
          lista += `• ${c.horario_id}\n`;
        });
        responseText = lista + "\n¿Deseas hacer algo más?\nEscribe *hola* para ver el menú.";
      }
    }
    // Opción 3: Reservar cita (directo a lista de horarios)
    else if (body === "3") {
      const { data: horarios, error: horError } = await supabase
        .from('horarios')
        .select('*')
        .eq('disponible', true)
        .order('id', { ascending: true });

      if (horError) throw horError;

      if (horarios.length === 0) {
        responseText = "⚠️ No hay horarios disponibles para reservar.\n\n¿Deseas hacer algo más?\nEscribe *hola* para ver el menú.";
      } else {
        let lista = "📅 *Elige un horario disponible:*\n\n";
        horarios.forEach((h, index) => {
          lista += `${index + 1}. ${h.dia} ${h.hora}\n`;
        });
        lista += "\nEscribe el *número* del horario que deseas reservar.";
        responseText = lista;
        userState.set(from, "reserving");
      }
    }
    // Manejar selección de horario (cuando el usuario elige 1, 2 o 3 después del listado)
    else if (userState.get(from) === "reserving") {
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
          responseText = `✅ ¡Cita confirmada!\n\n📅 *${horario.dia} ${horario.hora}*\n\nGracias por confiar en nuestro servicio. ¡Te esperamos!\n\n¿Deseas hacer algo más?\nEscribe *hola* para ver el menú.`;
        } else {
          responseText = "⚠️ Ese horario ya fue reservado por otro usuario. Elige otro.\n\nEscribe *hola* para ver el menú.";
        }
        userState.delete(from); // Volver al menú
      } else {
        // Opción inválida → mostrar menú
        responseText = "⚠️ Opción no válida. Por favor, elige una opción del menú.\n\n" +
          "Escribe *hola* para ver las opciones nuevamente.";
        userState.delete(from);
      }
    }
    // Cualquier otro mensaje → mostrar menú
    else {
      responseText = "⚠️ No reconocí tu mensaje. Por favor, elige una opción del menú.\n\n" +
        "Escribe *hola* para ver las opciones nuevamente.";
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
    await twilioClient.messages.create({
      body: "⚠️ Ocurrió un error. Por favor, escribe *hola* para intentar de nuevo.",
      from: 'whatsapp:+14155238886',
      to: from
    });
    res.status(500).send('Error');
  }
});

app.get('/', (req, res) => {
  res.send('Chatbot farmacéutico activo ✅');
});

// Render usa el puerto 10000 por defecto
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});