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

// Cache temporal para eliminación
const userCitasCache = new Map();

// Menú principal
const getMenu = () =>
  "💊 ¡Hola! Soy tu *botsito farmacéutico*. Bienvenido a la agenda de citas médicas.\n\n" +
  "¿Qué deseas hacer?\n" +
  "1️⃣ Programar horario de atención\n" +
  "2️⃣ Listar mis citas confirmadas\n" +
  "3️⃣ Eliminar una cita";

// Convertir índice a letra: 0 → A, 1 → B, 2 → C...
const toLetter = (index) => String.fromCharCode(65 + index);

app.post('/webhook', async (req, res) => {
  const from = req.body.From;
  const body = (req.body.Body || "").trim().toLowerCase();

  let responseText = "";

  try {
    if (body.includes("hola")) {
      responseText = getMenu();
    }
    // 1️⃣ Programar horario
    else if (body === "1") {
      const { data: horarios, error } = await supabase
        .from('horarios')
        .select('*')
        .eq('disponible', true)
        .order('id', { ascending: true });

      if (error) {
        console.error("Supabase error (horarios):", error);
        responseText = "⚠️ No se pudieron cargar los horarios. Inténtalo más tarde.\n\n" + getMenu();
      } else if (!horarios || horarios.length === 0) {
        responseText = "⚠️ No hay horarios disponibles.\n\n" + getMenu();
      } else {
        let msg = "📅 *Horarios disponibles:*\n\n";
        horarios.forEach((h, i) => {
          msg += `${toLetter(i)}. ${h.dia} ${h.hora}\n`;
        });
        msg += "\nEscribe la *letra* del horario que deseas reservar (ej: A).";
        responseText = msg;
      }
    }
    // 2️⃣ Listar citas
    else if (body === "2") {
      const { data: citas, error } = await supabase
        .from('citas')
        .select('id, horario_id')
        .eq('usuario', from)
        .order('fecha_confirmacion', { ascending: true });

      if (error) {
        console.error("Supabase error (citas):", error);
        responseText = "⚠️ No se pudieron cargar tus citas. Inténtalo más tarde.\n\n" + getMenu();
      } else if (!citas || citas.length === 0) {
        responseText = "📋 No tienes citas confirmadas.\n\n" + getMenu();
      } else {
        let msg = "📋 *Tus citas confirmadas:*\n\n";
        citas.forEach((c, i) => {
          msg += `${toLetter(i)}. ${c.horario_id}\n`;
        });
        responseText = msg + "\n" + getMenu();
      }
    }
    // 3️⃣ Eliminar cita
    else if (body === "3") {
      const { data: citas, error } = await supabase
        .from('citas')
        .select('id, horario_id')
        .eq('usuario', from)
        .order('fecha_confirmacion', { ascending: true });

      if (error) {
        console.error("Supabase error (eliminar):", error);
        responseText = "⚠️ No se pudieron cargar tus citas. Inténtalo más tarde.\n\n" + getMenu();
      } else if (!citas || citas.length === 0) {
        responseText = "📋 No tienes citas para eliminar.\n\n" + getMenu();
      } else {
        let msg = "🗑️ *Elige una cita para eliminar:*\n\n";
        citas.forEach((c, i) => {
          msg += `${toLetter(i)}. ${c.horario_id}\n`;
        });
        msg += "\nEscribe **X** seguido de la letra (ej: XA) para cancelar.";
        responseText = msg;
        userCitasCache.set(from, citas);
      }
    }
    // Reservar por letra (a, b, c)
    else if (body.length === 1 && /[a-c]/.test(body)) {
      const { data: horarios, error } = await supabase
        .from('horarios')
        .select('*')
        .eq('disponible', true)
        .order('id', { ascending: true });

      if (error) {
        console.error("Supabase error (reservar):", error);
        responseText = "⚠️ Error al reservar. Inténtalo más tarde.\n\n" + getMenu();
      } else if (!horarios || horarios.length === 0) {
        responseText = "⚠️ No hay horarios disponibles.\n\n" + getMenu();
      } else {
        const idx = body.charCodeAt(0) - 97;
        if (idx >= 0 && idx < horarios.length) {
          const h = horarios[idx];
          const { error: err1 } = await supabase
            .from('horarios')
            .update({ disponible: false })
            .eq('id', h.id)
            .eq('disponible', true);

          if (err1) {
            console.error("Supabase error (update):", err1);
            responseText = "⚠️ No se pudo reservar. Inténtalo más tarde.\n\n" + getMenu();
          } else {
            const { data } = await supabase
              .from('horarios')
              .select('disponible')
              .eq('id', h.id)
              .single();

            if (data && !data.disponible) {
              await supabase.from('citas').insert({
                usuario: from,
                horario_id: h.id,
                fecha_confirmacion: new Date().toISOString().split('T')[0]
              });
              responseText = `✅ ¡Cita confirmada para ${h.dia} ${h.hora}!\n\n` + getMenu();
            } else {
              responseText = "⚠️ Ese horario ya fue reservado.\n\n" + getMenu();
            }
          }
        } else {
          responseText = "⚠️ Letra no válida.\n\n" + getMenu();
        }
      }
    }
    // Eliminar con XA, XB, XC
    else if (/^x[a-z]$/i.test(body) && userCitasCache.has(from)) {
      const citas = userCitasCache.get(from);
      const letter = body.substring(1).toUpperCase();
      const idx = letter.charCodeAt(0) - 65;

      if (idx >= 0 && idx < citas.length) {
        const cita = citas[idx];
        try {
          await supabase.from('citas').delete().eq('id', cita.id);
          await supabase.from('horarios').update({ disponible: true }).eq('id', cita.horario_id);
          responseText = `✅ Cita *${cita.horario_id}* eliminada. El horario ya está disponible.\n\n` + getMenu();
        } catch (err) {
          console.error("Error al eliminar:", err);
          responseText = "⚠️ No se pudo eliminar la cita. Inténtalo más tarde.\n\n" + getMenu();
        }
      } else {
        responseText = "⚠️ Código de eliminación no válido (ej: XA).\n\n" + getMenu();
      }
      userCitasCache.delete(from);
    }
    // Cualquier otro mensaje
    else {
      responseText = "⚠️ No reconocí tu mensaje.\n\n" + getMenu();
    }

    // Enviar respuesta por WhatsApp
    await twilioClient.messages.create({
      body: responseText,
      from: 'whatsapp:+14155238886',
      to: from
    });

    res.status(200).send('<Response></Response>');
  } catch (error) {
    console.error("Error crítico:", error);
    // Evitar crash total: intentar enviar mensaje de error
    try {
      await twilioClient.messages.create({
        body: "⚠️ Ocurrió un error. Por favor, escribe *hola* para intentar de nuevo.",
        from: 'whatsapp:+14155238886',
        to: from
      });
    } catch (e) {
      console.error("No se pudo enviar mensaje de error:", e);
    }
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