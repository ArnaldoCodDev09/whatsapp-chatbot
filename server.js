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

// Función para mostrar el menú principal
const getMenu = () => 
  "💊 ¡Hola! Soy tu *botsito farmacéutico*. Bienvenido a la agenda de citas médicas.\n\n" +
  "¿Qué deseas hacer?\n" +
  "1️⃣ Programar horario de atención\n" +
  "2️⃣ Listar mis citas confirmadas";

app.post('/webhook', async (req, res) => {
  const from = req.body.From;
  const body = (req.body.Body || "").trim().toLowerCase();

  let responseText = "";

  try {
    // Siempre mostrar menú si dice "hola"
    if (body.includes("hola")) {
      responseText = getMenu();
    }
    // Opción 1: Mostrar horarios y permitir reserva si escribe un número del listado
    else if (body === "1") {
      const { data, error } = await supabase
        .from('horarios')
        .select('*')
        .eq('disponible', true)
        .order('id', { ascending: true });

      if (error) throw error;
      if (data.length === 0) {
        responseText = "⚠️ No hay horarios disponibles en este momento.\n\n" + getMenu();
      } else {
        let lista = "📅 *Horarios disponibles:*\n\n";
        data.forEach((h, index) => {
          lista += `${index + 1}. ${h.dia} ${h.hora}\n`;
        });
        lista += "\nEscribe el *número* del horario que deseas reservar.";
        responseText = lista;
      }
    }
    // Opción 2: Listar citas confirmadas
    else if (body === "2") {
      const { data, error } = await supabase
        .from('citas')
        .select('horario_id')
        .eq('usuario', from);

      if (error) throw error;
      if (data.length === 0) {
        responseText = "📋 Aún no tienes citas confirmadas.\n\n" + getMenu();
      } else {
        let lista = "📋 *Tus citas confirmadas:*\n\n";
        data.forEach(c => {
          lista += `• ${c.horario_id}\n`;
        });
        responseText = lista + "\n" + getMenu();
      }
    }
    // Manejar selección de horario: solo si el mensaje es "1", "2" o "3" Y el usuario ya eligió opción 1 antes
    // Pero como no usamos estado, solo aceptamos números si están entre 1-3 y hay horarios disponibles
    else if (/^[123]$/.test(body)) {
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

        // Reservar
        const { error: updateError } = await supabase
          .from('horarios')
          .update({ disponible: false })
          .eq('id', horario_id)
          .eq('disponible', true);

        if (updateError) throw updateError;

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
          responseText = `✅ ¡Cita confirmada para ${horario.dia} ${horario.hora}!\n\n` + getMenu();
        } else {
          responseText = "⚠️ Ese horario ya fue reservado.\n\n" + getMenu();
        }
      } else {
        responseText = "⚠️ Opción no válida. Por favor, elige una opción del menú:\n\n" + getMenu();
      }
    }
    // Cualquier otro mensaje
    else {
      responseText = "⚠️ No reconocí tu mensaje. Por favor, elige una opción del menú:\n\n" + getMenu();
    }

    // Enviar respuesta
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

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});