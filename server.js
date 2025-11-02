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
    if (body.includes("hola") || body === "1") {
      const { data, error } = await supabase
        .from('horarios')
        .select('*')
        .eq('disponible', true);
      
      if (error) throw error;
      if (data.length === 0) {
        responseText = "No hay horarios disponibles.";
      } else {
        let lista = "Horarios disponibles:\n";
        data.forEach(h => {
          lista += `- ${h.dia} ${h.hora}\n`;
        });
        lista += "\nEscribe exactamente: lunes 10:00, lunes 11:00 o martes 15:00";
        responseText = lista;
      }
    }
    else if (["lunes 10:00", "lunes 11:00", "martes 15:00"].includes(body)) {
      let idMap = {
        "lunes 10:00": "lun10",
        "lunes 11:00": "lun11",
        "martes 15:00": "mar15"
      };
      const horario_id = idMap[body];

      // Marcar como no disponible
      const { error: updateError } = await supabase
        .from('horarios')
        .update({ disponible: false })
        .eq('id', horario_id)
        .eq('disponible', true);

      if (updateError) throw updateError;

      // Verificar si se actualizó (evita doble reserva)
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
        responseText = `Cita confirmada para ${body}.`;
      } else {
        responseText = "Ese horario ya no está disponible.";
      }
    }
    else if (body === "2") {
      const { data, error } = await supabase
        .from('citas')
        .select('horario_id')
        .eq('usuario', from);
      
      if (error) throw error;
      if (data.length === 0) {
        responseText = "No tienes citas confirmadas.";
      } else {
        let lista = "Tus citas confirmadas:\n";
        data.forEach(c => {
          lista += `- ${c.horario_id}\n`;
        });
        responseText = lista;
      }
    }
    else {
      responseText = "Escribe:\n1. Ver horarios\n2. Ver mis citas";
    }

    // Enviar respuesta por WhatsApp
    await twilioClient.messages.create({
      body: responseText,
      from: 'whatsapp:+14155238886',
      to: from
    });

    res.status(200).send('<Response></Response>');
  } catch (error) {
    console.error(error);
    res.status(500).send('Error');
  }
});

app.get('/', (req, res) => {
  res.send('Chatbot activo');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});