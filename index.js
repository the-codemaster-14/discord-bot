const { Client, GatewayIntentBits } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const BOT_TOKEN = process.env.BOT_TOKEN;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function currentMonthKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

async function getAllClients() {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .order('name', { ascending: true });

  if (error) throw error;
  return data || [];
}

async function getClientByEmail(email) {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('email', email.toLowerCase())
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function addClient({ name, phone, email, sessions_total }) {
  const { data, error } = await supabase
    .from('clients')
    .insert([{
      name,
      phone,
      email: email.toLowerCase(),
      sessions_used: 0,
      sessions_total,
      booked_this_month: 0,
      last_reset_month: currentMonthKey()
    }])
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function updateClientByEmail(email, updates) {
  const { data, error } = await supabase
    .from('clients')
    .update(updates)
    .eq('email', email.toLowerCase())
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function resetMonthlyCountsIfNeeded() {
  const clients = await getAllClients();
  const thisMonth = currentMonthKey();

  for (const c of clients) {
    if (c.last_reset_month !== thisMonth) {
      await updateClientByEmail(c.email, {
        booked_this_month: 0,
        last_reset_month: thisMonth
      });
    }
  }
}

function formatClientLine(c) {
  const remaining = c.sessions_total - c.sessions_used;
  return `${c.name} | ${c.email} | Used: ${c.sessions_used}/${c.sessions_total} | Remaining: ${remaining} | This month: ${c.booked_this_month}`;
}

function getUsageStatusMessage(c) {
  const remaining = c.sessions_total - c.sessions_used;

  if (c.sessions_used > c.sessions_total) {
    return `❌ Over limit. This client is at ${c.sessions_used}/${c.sessions_total}.`;
  }

  if (c.sessions_used === c.sessions_total) {
    return `❗ Limit reached. This client is at ${c.sessions_used}/${c.sessions_total}.`;
  }

  if (c.sessions_used === c.sessions_total - 1) {
    return `⚠ Renewal soon. This client is at ${c.sessions_used}/${c.sessions_total}.`;
  }

  return `Sessions remaining: ${remaining}`;
}

setInterval(async () => {
  try {
    await resetMonthlyCountsIfNeeded();
  } catch (error) {
    console.error('Monthly reset error:', error);
  }
}, 60 * 60 * 1000);

client.once('clientReady', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  try {
    await resetMonthlyCountsIfNeeded();
  } catch (error) {
    console.error('Startup reset error:', error);
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  try {
    await resetMonthlyCountsIfNeeded();

    const args = message.content.trim().split(' ');
    const command = args[0]?.toLowerCase();

    if (command === '!addclient') {
      const name = args[1];
      const phone = args[2];
      const email = args[3]?.toLowerCase();
      const totalSessions = Number(args[4] || 6);

      if (!name || !phone || !email) {
        return message.reply('Usage: !addclient Name phone email@example.com totalSessions');
      }

      const existing = await getClientByEmail(email);
      if (existing) {
        return message.reply('Client already exists.');
      }

      await addClient({
        name,
        phone,
        email,
        sessions_total: totalSessions
      });

      return message.reply(`Added ${name}`);
    }

    if (command === '!listclients') {
      const limit = Number(args[1]) || 20;
      const safeLimit = Math.min(Math.max(limit, 1), 100);

      const clients = await getAllClients();

      if (clients.length === 0) {
        return message.reply('No clients yet.');
      }

      const limitedClients = clients.slice(0, safeLimit);
      const text = limitedClients.map(formatClientLine).join('\n');

      return message.reply(
`Showing ${limitedClients.length} of ${clients.length} clients:
${text}`
      );
    }

    if (command === '!searchclient') {
      const query = args.slice(1).join(' ').trim().toLowerCase();

      if (!query) {
        return message.reply('Usage: !searchclient name or email');
      }

      const clients = await getAllClients();

      const matches = clients.filter(c =>
        (c.name && c.name.toLowerCase().includes(query)) ||
        (c.email && c.email.toLowerCase().includes(query)) ||
        (c.phone && c.phone.toLowerCase().includes(query))
      );

      if (matches.length === 0) {
        return message.reply('No matching clients found.');
      }

      const limitedMatches = matches.slice(0, 20);
      const text = limitedMatches.map(formatClientLine).join('\n');

      return message.reply(
`Found ${matches.length} matching client(s). Showing ${limitedMatches.length}:
${text}`
      );
    }

    if (command === '!client') {
      const query = args.slice(1).join(' ').trim().toLowerCase();

      if (!query) {
        return message.reply('Usage: !client email@example.com or !client partial name');
      }

      const exactEmailMatch = await getClientByEmail(query);

      if (exactEmailMatch) {
        const remaining = exactEmailMatch.sessions_total - exactEmailMatch.sessions_used;

        return message.reply(
`${exactEmailMatch.name}
Phone: ${exactEmailMatch.phone || ''}
Email: ${exactEmailMatch.email}
Sessions Used: ${exactEmailMatch.sessions_used}/${exactEmailMatch.sessions_total}
Sessions Remaining: ${remaining}
Booked This Month: ${exactEmailMatch.booked_this_month}
${getUsageStatusMessage(exactEmailMatch)}`
        );
      }

      const clients = await getAllClients();

      const matches = clients.filter(c =>
        (c.name && c.name.toLowerCase().includes(query)) ||
        (c.email && c.email.toLowerCase().includes(query)) ||
        (c.phone && c.phone.toLowerCase().includes(query))
      );

      if (matches.length === 0) {
        return message.reply('Client not found.');
      }

      if (matches.length === 1) {
        const c = matches[0];
        const remaining = c.sessions_total - c.sessions_used;

        return message.reply(
`${c.name}
Phone: ${c.phone || ''}
Email: ${c.email}
Sessions Used: ${c.sessions_used}/${c.sessions_total}
Sessions Remaining: ${remaining}
Booked This Month: ${c.booked_this_month}
${getUsageStatusMessage(c)}`
        );
      }

      const limitedMatches = matches.slice(0, 10);
      const text = limitedMatches.map(c => formatClientLine(c)).join('\n');

      return message.reply(
`Found ${matches.length} matching clients. Be more specific or use the exact email.
Showing ${limitedMatches.length}:
${text}`
      );
    }

    if (command === '!book') {
      const email = args[1]?.toLowerCase();
      const bookingDate = args[2];
      const bookingTime = args[3];

      if (!email || !bookingDate || !bookingTime) {
        return message.reply('Usage: !book email@example.com April-18-2026 1:00PM');
      }

      const c = await getClientByEmail(email);

      if (!c) {
        return message.reply('Client not found.');
      }

      if (c.sessions_used >= c.sessions_total) {
        return message.reply(
`❌ Booking blocked.
${c.name} is already at ${c.sessions_used}/${c.sessions_total}. Renew them first if needed.`
        );
      }

      const updated = await updateClientByEmail(email, {
        sessions_used: c.sessions_used + 1,
        booked_this_month: c.booked_this_month + 1
      });

      const sessionsRemaining = updated.sessions_total - updated.sessions_used;

      return message.reply(
`${updated.name} has booked for ${bookingDate} at ${bookingTime}.
Sessions remaining: ${sessionsRemaining}

Email: ${updated.email}
Phone: ${updated.phone || ''}
Booked this month: ${updated.booked_this_month}
${getUsageStatusMessage(updated)}`
      );
    }

    if (command === '!undosession') {
      const email = args[1]?.toLowerCase();

      if (!email) {
        return message.reply('Usage: !undosession email@example.com');
      }

      const c = await getClientByEmail(email);

      if (!c) {
        return message.reply('Client not found.');
      }

      const updated = await updateClientByEmail(email, {
        sessions_used: Math.max(0, c.sessions_used - 1),
        booked_this_month: Math.max(0, c.booked_this_month - 1)
      });

      return message.reply(`Removed one booking/session from ${updated.name}`);
    }

    if (command === '!setphone') {
      const email = args[1]?.toLowerCase();
      const phone = args[2];

      if (!email || !phone) {
        return message.reply('Usage: !setphone email@example.com 416-555-1234');
      }

      const c = await getClientByEmail(email);

      if (!c) {
        return message.reply('Client not found.');
      }

      await updateClientByEmail(email, { phone });
      return message.reply(`Updated phone for ${c.name}`);
    }

    if (command === '!setsessions') {
      const email = args[1]?.toLowerCase();
      const total = Number(args[2]);

      if (!email || Number.isNaN(total)) {
        return message.reply('Usage: !setsessions email@example.com 6');
      }

      const c = await getClientByEmail(email);

      if (!c) {
        return message.reply('Client not found.');
      }

      await updateClientByEmail(email, { sessions_total: total });
      return message.reply(`Updated total sessions for ${c.name} to ${total}`);
    }

    if (command === '!renewclient') {
      const email = args[1]?.toLowerCase();
      const total = Number(args[2] || 6);

      if (!email || Number.isNaN(total)) {
        return message.reply('Usage: !renewclient email@example.com 6');
      }

      const c = await getClientByEmail(email);

      if (!c) {
        return message.reply('Client not found.');
      }

      const updated = await updateClientByEmail(email, {
        sessions_used: 0,
        sessions_total: total,
        booked_this_month: 0,
        last_reset_month: currentMonthKey()
      });

      return message.reply(
`✅ Renewed ${updated.name}.
Sessions reset to 0/${updated.sessions_total}.`
      );
    }

    if (command === '!removeclient') {
      const email = args[1]?.toLowerCase();

      if (!email) {
        return message.reply('Usage: !removeclient email@example.com');
      }

      const { error } = await supabase
        .from('clients')
        .delete()
        .eq('email', email);

      if (error) throw error;

      return message.reply(`Removed ${email}`);
    }

    if (command === '!resetmonth') {
      const clients = await getAllClients();
      const thisMonth = currentMonthKey();

      for (const c of clients) {
        await updateClientByEmail(c.email, {
          booked_this_month: 0,
          last_reset_month: thisMonth
        });
      }

      return message.reply('Monthly booking counts reset.');
    }

    if (command === '!helpbot') {
      return message.reply(
`Commands:
!addclient Name phone email@example.com totalSessions
!listclients
!listclients 10
!searchclient name or email
!client email@example.com
!client partial name
!book email@example.com April-18-2026 1:00PM
!undosession email@example.com
!setphone email@example.com 416-555-1234
!setsessions email@example.com 6
!renewclient email@example.com 6
!removeclient email@example.com
!resetmonth`
      );
    }
  } catch (error) {
    console.error(error);
    return message.reply('Something went wrong.');
  }
});

client.login(BOT_TOKEN);
