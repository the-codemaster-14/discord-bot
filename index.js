const {
  Client,
  GatewayIntentBits,
  AttachmentBuilder,
  SlashCommandBuilder
} = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const { Parser } = require('json2csv');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const MONTHLY_REMINDERS_CHANNEL_ID = process.env.MONTHLY_REMINDERS_CHANNEL_ID || '';

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

async function addClient({ name, phone, email, sessions_total, notes = '' }) {
  const { data, error } = await supabase
    .from('clients')
    .insert([{
      name,
      phone,
      email: email.toLowerCase(),
      sessions_used: 0,
      sessions_total,
      booked_this_month: 0,
      last_reset_month: currentMonthKey(),
      notes
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
async function getBotMeta(key) {
  const { data, error } = await supabase
    .from('bot_meta')
    .select('*')
    .eq('meta_key', key)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function setBotMeta(key, value) {
  const { error } = await supabase
    .from('bot_meta')
    .upsert([{
      meta_key: key,
      meta_value: value,
      updated_at: new Date().toISOString()
    }], { onConflict: 'meta_key' });

  if (error) throw error;
}

function getTorontoDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  const year = Number(parts.find(p => p.type === 'year')?.value);
  const month = Number(parts.find(p => p.type === 'month')?.value);
  const day = Number(parts.find(p => p.type === 'day')?.value);

  return { year, month, day };
}

function getFridayBeforeLastWeek(year, month) {
  // month is 1-12
  const lastDay = new Date(Date.UTC(year, month, 0));
  const lastDayWeekday = lastDay.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat

  // Monday of the week containing the last day of the month
  const mondayOffset = (lastDayWeekday + 6) % 7;
  const mondayOfLastWeek = lastDay.getUTCDate() - mondayOffset;

  // Friday before that week starts = Monday - 3 days
  const target = new Date(Date.UTC(year, month - 1, mondayOfLastWeek - 3, 12));

  return {
    year: target.getUTCFullYear(),
    month: target.getUTCMonth() + 1,
    day: target.getUTCDate()
  };
}

function sameDateParts(a, b) {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

async function sendMonthlyInactiveReminder() {
  if (!MONTHLY_REMINDERS_CHANNEL_ID) return false;

  const today = getTorontoDateParts();
  const target = getFridayBeforeLastWeek(today.year, today.month);

  if (!sameDateParts(today, target)) {
    return false;
  }

  const monthKey = `${today.year}-${String(today.month).padStart(2, '0')}`;
  const alreadySent = await getBotMeta('monthly_inactive_reminder_last_sent');

  if (alreadySent?.meta_value === monthKey) {
    return false;
  }

  const clients = await getAllClients();
  const inactive = clients.filter(c => Number(c.booked_this_month) === 0);

  const channel = await client.channels.fetch(MONTHLY_REMINDERS_CHANNEL_ID).catch(() => null);

  if (!channel || !channel.isTextBased()) {
    return false;
  }

  const preview = inactive.slice(0, 50).map(c => {
    const remaining = c.sessions_total - c.sessions_used;
    return `${c.name} | ${c.email} | Used: ${c.sessions_used}/${c.sessions_total} | Remaining: ${remaining}`;
  }).join('\n');

  const csv = buildCsv(inactive);
  const buffer = Buffer.from(csv, 'utf-8');
  const attachment = new AttachmentBuilder(buffer, {
    name: `inactive-clients-${monthKey}.csv`
  });

  await channel.send({
    content: inactive.length === 0
      ? `📌 Monthly reminder: everyone has booked for ${monthKey}.`
      : `📌 Monthly reminder: ${inactive.length} client(s) have not booked for ${monthKey}.\n\nShowing first ${Math.min(inactive.length, 50)}:\n${preview}`,
    files: [attachment]
  });

  await setBotMeta('monthly_inactive_reminder_last_sent', monthKey);
  return true;
}

async function forceSendMonthlyInactiveReminder() {
  if (!MONTHLY_REMINDERS_CHANNEL_ID) {
    return false;
  }

  const today = getTorontoDateParts();
  const monthKey = `${today.year}-${String(today.month).padStart(2, '0')}`;

  const clients = await getAllClients();
  const inactive = clients.filter(c => Number(c.booked_this_month) === 0);

  const channel = await client.channels.fetch(MONTHLY_REMINDERS_CHANNEL_ID).catch(() => null);

  if (!channel || !channel.isTextBased()) {
    return false;
  }

  const preview = inactive.slice(0, 50).map(c => {
    const remaining = c.sessions_total - c.sessions_used;
    return `${c.name} | ${c.email} | Used: ${c.sessions_used}/${c.sessions_total} | Remaining: ${remaining}`;
  }).join('\n');

  const csv = buildCsv(inactive);
  const buffer = Buffer.from(csv, 'utf-8');
  const attachment = new AttachmentBuilder(buffer, {
    name: `inactive-clients-${monthKey}.csv`
  });

  await channel.send({
    content: inactive.length === 0
      ? `📌 Manual monthly reminder test: everyone has booked for ${monthKey}.`
      : `📌 Manual monthly reminder test: ${inactive.length} client(s) have not booked for ${monthKey}.\n\nShowing first ${Math.min(inactive.length, 50)}:\n${preview}`,
    files: [attachment]
  });

  return true;
}

function formatClientLine(c) {
  const remaining = c.sessions_total - c.sessions_used;
  return `${c.name} | ${c.email} | Used: ${c.sessions_used}/${c.sessions_total} | Remaining: ${remaining} | This month: ${c.booked_this_month}`;
}

function formatClientDetails(c) {
  const remaining = c.sessions_total - c.sessions_used;
  return `${c.name}
Phone: ${c.phone || ''}
Email: ${c.email}
Sessions Used: ${c.sessions_used}/${c.sessions_total}
Sessions Remaining: ${remaining}
Booked This Month: ${c.booked_this_month}
Notes: ${c.notes || 'None'}`;
}

function escapeCsvValue(value) {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildCsv(clients) {
  const fields = [
    'name',
    'phone',
    'email',
    'sessions_used',
    'sessions_total',
    'booked_this_month',
    'last_reset_month',
    'notes'
  ];

  const rows = clients.map(c => [
    c.name,
    c.phone || '',
    c.email,
    c.sessions_used,
    c.sessions_total,
    c.booked_this_month,
    c.last_reset_month || '',
    c.notes || ''
  ]);

  return [
    fields.join(','),
    ...rows.map(row => row.map(escapeCsvValue).join(','))
  ].join('\n');
}

async function replyText(target, content) {
  if ('author' in target) {
    return target.reply(content);
  }

  if (target.replied || target.deferred) {
    return target.followUp({ content });
  }

  return target.reply({ content });
}

async function handleListClients(target, limit = 20, page = 1) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);

  const clients = await getAllClients();

  if (clients.length === 0) {
    return replyText(target, 'No clients yet.');
  }

  const start = (safePage - 1) * safeLimit;
  const end = start + safeLimit;
  const pageClients = clients.slice(start, end);

  if (pageClients.length === 0) {
    return replyText(target, 'No clients on that page.');
  }

  const text = pageClients.map(formatClientLine).join('\n');

  return replyText(
    target,
    `Showing ${pageClients.length} of ${clients.length} clients (page ${safePage}):\n${text}`
  );
}

async function handleSearchClient(target, query) {
  const normalized = String(query || '').trim().toLowerCase();

  if (!normalized) {
    return replyText(target, 'Usage: !searchclient name or email');
  }

  const clients = await getAllClients();

  const matches = clients.filter(c =>
    (c.name && c.name.toLowerCase().includes(normalized)) ||
    (c.email && c.email.toLowerCase().includes(normalized)) ||
    (c.phone && c.phone.toLowerCase().includes(normalized))
  );

  if (matches.length === 0) {
    return replyText(target, 'No matching clients found.');
  }

  const limitedMatches = matches.slice(0, 20);
  const text = limitedMatches.map(formatClientLine).join('\n');

  return replyText(
    target,
    `Found ${matches.length} matching client(s). Showing ${limitedMatches.length}:\n${text}`
  );
}

async function handleClient(target, query) {
  const normalized = String(query || '').trim().toLowerCase();

  if (!normalized) {
    return replyText(target, 'Usage: !client email@example.com or !client partial name');
  }

  const exactEmailMatch = await getClientByEmail(normalized);

  if (exactEmailMatch) {
    return replyText(target, formatClientDetails(exactEmailMatch));
  }

  const clients = await getAllClients();

  const matches = clients.filter(c =>
    (c.name && c.name.toLowerCase().includes(normalized)) ||
    (c.email && c.email.toLowerCase().includes(normalized)) ||
    (c.phone && c.phone.toLowerCase().includes(normalized))
  );

  if (matches.length === 0) {
    return replyText(target, 'Client not found.');
  }

  if (matches.length === 1) {
    return replyText(target, formatClientDetails(matches[0]));
  }

  const limitedMatches = matches.slice(0, 10);
  const text = limitedMatches.map(formatClientLine).join('\n');

  return replyText(
    target,
    `Found ${matches.length} matching clients. Be more specific or use the exact email.\nShowing ${limitedMatches.length}:\n${text}`
  );
}

async function handleInactiveClients(target, limit = 20, page = 1) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);

  const clients = await getAllClients();
  const inactive = clients.filter(c => Number(c.booked_this_month) === 0);

  if (inactive.length === 0) {
    return replyText(target, 'Everyone has booked this month.');
  }

  const start = (safePage - 1) * safeLimit;
  const end = start + safeLimit;
  const pageClients = inactive.slice(start, end);

  if (pageClients.length === 0) {
    return replyText(target, 'No inactive clients on that page.');
  }

  const text = pageClients.map(c => {
    const remaining = c.sessions_total - c.sessions_used;
    return `${c.name} | ${c.email} | Used: ${c.sessions_used}/${c.sessions_total} | Remaining: ${remaining}`;
  }).join('\n');

  return replyText(
    target,
    `Showing ${pageClients.length} of ${inactive.length} clients with no bookings this month (page ${safePage}):\n${text}`
  );
}

async function handleRenewals(target, limit = 20) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);

  const clients = await getAllClients();
  const renewalClients = clients.filter(c => c.sessions_used >= c.sessions_total - 1);

  if (renewalClients.length === 0) {
    return replyText(target, 'No clients currently need renewal attention.');
  }

  const limited = renewalClients.slice(0, safeLimit);
  const text = limited.map(formatClientLine).join('\n');

  return replyText(
    target,
    `Showing ${limited.length} of ${renewalClients.length} clients needing renewal attention:\n${text}`
  );
}

async function handleAddClient(target, name, phone, email, totalSessions = 6, notes = '') {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const total = Number(totalSessions || 6);

  if (!name || !phone || !normalizedEmail || Number.isNaN(total)) {
    return replyText(target, 'Usage: !addclient Name phone email@example.com totalSessions [notes]');
  }

  const existing = await getClientByEmail(normalizedEmail);
  if (existing) {
    return replyText(target, 'Client already exists.');
  }

  const added = await addClient({
    name,
    phone,
    email: normalizedEmail,
    sessions_total: total,
    notes
  });

  return replyText(target, `Added ${added.name}`);
}

async function handleBook(target, email, bookingDate, bookingTime) {
  const normalizedEmail = String(email || '').trim().toLowerCase();

  if (!normalizedEmail || !bookingDate || !bookingTime) {
    return replyText(target, 'Usage: !book email@example.com April-18-2026 1:00PM');
  }

  const c = await getClientByEmail(normalizedEmail);

  if (!c) {
    return replyText(target, 'Client not found.');
  }

  if (c.sessions_used >= c.sessions_total) {
    return replyText(
      target,
      `❌ Booking blocked.\n${c.name} is already at ${c.sessions_used}/${c.sessions_total}. Renew them first if needed.`
    );
  }

  const updated = await updateClientByEmail(normalizedEmail, {
    sessions_used: c.sessions_used + 1,
    booked_this_month: c.booked_this_month + 1
  });

  const sessionsRemaining = updated.sessions_total - updated.sessions_used;

  return replyText(
    target,
    `${updated.name} has booked for ${bookingDate} at ${bookingTime}.
Sessions remaining: ${sessionsRemaining}

Email: ${updated.email}
Phone: ${updated.phone || ''}
Booked this month: ${updated.booked_this_month}
Notes: ${updated.notes || 'None'}`
  );
}

async function handleUndoSession(target, email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();

  if (!normalizedEmail) {
    return replyText(target, 'Usage: !undosession email@example.com');
  }

  const c = await getClientByEmail(normalizedEmail);

  if (!c) {
    return replyText(target, 'Client not found.');
  }

  const updated = await updateClientByEmail(normalizedEmail, {
    sessions_used: Math.max(0, c.sessions_used - 1),
    booked_this_month: Math.max(0, c.booked_this_month - 1)
  });

  return replyText(target, `Removed one booking/session from ${updated.name}`);
}

async function handleSetPhone(target, email, phone) {
  const normalizedEmail = String(email || '').trim().toLowerCase();

  if (!normalizedEmail || !phone) {
    return replyText(target, 'Usage: !setphone email@example.com 416-555-1234');
  }

  const c = await getClientByEmail(normalizedEmail);

  if (!c) {
    return replyText(target, 'Client not found.');
  }

  await updateClientByEmail(normalizedEmail, { phone });
  return replyText(target, `Updated phone for ${c.name}`);
}

async function handleSetUsed(target, email, used) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const numericUsed = Number(used);

  if (!normalizedEmail || Number.isNaN(numericUsed)) {
    return replyText(target, 'Usage: !setused email@example.com 1');
  }

  const c = await getClientByEmail(normalizedEmail);

  if (!c) {
    return replyText(target, 'Client not found.');
  }

  const updated = await updateClientByEmail(normalizedEmail, {
    sessions_used: Math.max(0, numericUsed)
  });

  return replyText(target, `Updated ${updated.name} to ${updated.sessions_used}/${updated.sessions_total}`);
}

async function handleSetBookedMonth(target, email, booked) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const numericBooked = Number(booked);

  if (!normalizedEmail || Number.isNaN(numericBooked)) {
    return replyText(target, 'Usage: !setbookedmonth email@example.com 1');
  }

  const c = await getClientByEmail(normalizedEmail);

  if (!c) {
    return replyText(target, 'Client not found.');
  }

  const updated = await updateClientByEmail(normalizedEmail, {
    booked_this_month: Math.max(0, numericBooked)
  });

  return replyText(target, `Updated ${updated.name} booked_this_month to ${updated.booked_this_month}`);
}

async function handleSetTotal(target, email, total) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const numericTotal = Number(total);

  if (!normalizedEmail || Number.isNaN(numericTotal)) {
    return replyText(target, 'Usage: !settotal email@example.com 6');
  }

  const c = await getClientByEmail(normalizedEmail);

  if (!c) {
    return replyText(target, 'Client not found.');
  }

  const updated = await updateClientByEmail(normalizedEmail, {
    sessions_total: numericTotal
  });

  return replyText(target, `Updated total sessions for ${updated.name} to ${numericTotal}`);
}

async function handleRenewClient(target, email, total = 6) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const numericTotal = Number(total || 6);

  if (!normalizedEmail || Number.isNaN(numericTotal)) {
    return replyText(target, 'Usage: !renewclient email@example.com 6');
  }

  const c = await getClientByEmail(normalizedEmail);

  if (!c) {
    return replyText(target, 'Client not found.');
  }

  const updated = await updateClientByEmail(normalizedEmail, {
    sessions_used: 0,
    sessions_total: numericTotal,
    booked_this_month: 0,
    last_reset_month: currentMonthKey()
  });

  return replyText(target, `✅ Renewed ${updated.name}. Sessions reset to 0/${updated.sessions_total}.`);
}

async function handleSetNote(target, email, note) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const noteText = String(note || '').trim();

  if (!normalizedEmail || !noteText) {
    return replyText(target, 'Usage: !setnote email@example.com your note here');
  }

  const c = await getClientByEmail(normalizedEmail);

  if (!c) {
    return replyText(target, 'Client not found.');
  }

  const updated = await updateClientByEmail(normalizedEmail, {
    notes: noteText
  });

  return replyText(target, `Updated notes for ${updated.name}`);
}

async function handleNote(target, email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();

  if (!normalizedEmail) {
    return replyText(target, 'Usage: !note email@example.com');
  }

  const c = await getClientByEmail(normalizedEmail);

  if (!c) {
    return replyText(target, 'Client not found.');
  }

  return replyText(target, `${c.name}\nNotes: ${c.notes || 'None'}`);
}

async function handleExportCsv(target) {
  const clients = await getAllClients();

  if (clients.length === 0) {
    return replyText(target, 'No clients to export.');
  }

  const csv = buildCsv(clients);
  const buffer = Buffer.from(csv, 'utf-8');
  const attachment = new AttachmentBuilder(buffer, { name: 'clients.csv' });

  if ('author' in target) {
    return target.reply({
      content: 'Client export:',
      files: [attachment]
    });
  }

  if (target.replied || target.deferred) {
    return target.followUp({
      content: 'Client export:',
      files: [attachment]
    });
  }

  return target.reply({
    content: 'Client export:',
    files: [attachment]
  });
}

async function handleRemoveClient(target, email, confirmWord) {
  const normalizedEmail = String(email || '').trim().toLowerCase();

  if (!normalizedEmail || String(confirmWord || '').toLowerCase() !== 'confirm') {
    return replyText(target, 'Usage: !removeclient email@example.com confirm');
  }

  const c = await getClientByEmail(normalizedEmail);

  if (!c) {
    return replyText(target, 'Client not found.');
  }

  const { error } = await supabase
    .from('clients')
    .delete()
    .eq('email', normalizedEmail);

  if (error) throw error;

  return replyText(target, `Removed ${normalizedEmail}`);
}

async function handleResetMonth(target, confirmWord) {
  if (String(confirmWord || '').toLowerCase() !== 'confirm') {
    return replyText(target, 'Usage: !resetmonth confirm');
  }

  const clients = await getAllClients();
  const thisMonth = currentMonthKey();

  for (const c of clients) {
    await updateClientByEmail(c.email, {
      booked_this_month: 0,
      last_reset_month: thisMonth
    });
  }

  return replyText(target, 'Monthly booking counts reset.');
}

const slashCommands = [
  new SlashCommandBuilder()
    .setName('client')
    .setDescription('Show one client by exact email or partial name')
    .addStringOption(o => o.setName('query').setDescription('Email, name, or phone').setRequired(true)),

  new SlashCommandBuilder()
    .setName('searchclient')
    .setDescription('Search clients by name, email, or phone')
    .addStringOption(o => o.setName('query').setDescription('Search query').setRequired(true)),

  new SlashCommandBuilder()
    .setName('listclients')
    .setDescription('List clients with pagination')
    .addIntegerOption(o => o.setName('limit').setDescription('How many to show'))
    .addIntegerOption(o => o.setName('page').setDescription('Page number')),

  new SlashCommandBuilder()
    .setName('inactiveclients')
    .setDescription('Show clients with no bookings this month')
    .addIntegerOption(o => o.setName('limit').setDescription('How many to show'))
    .addIntegerOption(o => o.setName('page').setDescription('Page number')),

  new SlashCommandBuilder()
    .setName('renewals')
    .setDescription('Show clients needing renewal attention')
    .addIntegerOption(o => o.setName('limit').setDescription('How many to show')),

  new SlashCommandBuilder()
    .setName('addclient')
    .setDescription('Add a new client')
    .addStringOption(o => o.setName('name').setDescription('Client name').setRequired(true))
    .addStringOption(o => o.setName('phone').setDescription('Phone number').setRequired(true))
    .addStringOption(o => o.setName('email').setDescription('Email').setRequired(true))
    .addIntegerOption(o => o.setName('total_sessions').setDescription('Total sessions'))
    .addStringOption(o => o.setName('notes').setDescription('Optional notes')),

  new SlashCommandBuilder()
    .setName('renewclient')
    .setDescription('Renew a client and reset usage')
    .addStringOption(o => o.setName('email').setDescription('Client email').setRequired(true))
    .addIntegerOption(o => o.setName('total').setDescription('New total sessions')),

  new SlashCommandBuilder()
    .setName('setused')
    .setDescription('Set used sessions exactly')
    .addStringOption(o => o.setName('email').setDescription('Client email').setRequired(true))
    .addIntegerOption(o => o.setName('used').setDescription('Used sessions').setRequired(true)),

  new SlashCommandBuilder()
    .setName('setbookedmonth')
    .setDescription('Set booked_this_month exactly')
    .addStringOption(o => o.setName('email').setDescription('Client email').setRequired(true))
    .addIntegerOption(o => o.setName('count').setDescription('Booked this month').setRequired(true)),

  new SlashCommandBuilder()
    .setName('settotal')
    .setDescription('Set total sessions exactly')
    .addStringOption(o => o.setName('email').setDescription('Client email').setRequired(true))
    .addIntegerOption(o => o.setName('total').setDescription('Total sessions').setRequired(true)),

  new SlashCommandBuilder()
    .setName('setnote')
    .setDescription('Set client notes')
    .addStringOption(o => o.setName('email').setDescription('Client email').setRequired(true))
    .addStringOption(o => o.setName('note').setDescription('New note').setRequired(true)),

  new SlashCommandBuilder()
    .setName('exportcsv')
    .setDescription('Export all clients as CSV')
].map(c => c.toJSON());

client.once('clientReady', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  try {
    await resetMonthlyCountsIfNeeded();
    await sendMonthlyInactiveReminder();
    await client.application.commands.set(slashCommands);
    console.log('Slash commands registered');
  } catch (error) {
    console.error('Startup error:', error);
  }
});

setInterval(async () => {
  try {
    await resetMonthlyCountsIfNeeded();
    await sendMonthlyInactiveReminder();
  } catch (error) {
    console.error('Monthly scheduled task error:', error);
  }
}, 60 * 60 * 1000);

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.trim().startsWith('!')) return;

  try {
    await resetMonthlyCountsIfNeeded();

    const args = message.content.trim().split(' ');
    const command = args[0]?.toLowerCase();

  if (command === '!monthlyreminder') {
  const sent = await forceSendMonthlyInactiveReminder();

  if (!sent) {
    return message.reply('Could not send monthly reminder. Check MONTHLY_REMINDERS_CHANNEL_ID.');
  }

  return message.reply('Monthly reminder sent to the monthly reminders channel.');
}

    if (command === '!helpbot') {
      return message.reply(
`Commands:
!addclient Name phone email@example.com totalSessions [notes]
!listclients
!listclients 10
!listclients 10 2
!searchclient query
!client query
!inactiveclients
!inactiveclients 20
!inactiveclients 20 2
!renewals
!renewals 20
!book email@example.com April-18-2026 1:00PM
!undosession email@example.com
!setphone email@example.com 416-555-1234
!setused email@example.com 1
!setbookedmonth email@example.com 1
!setsessions email@example.com 6
!settotal email@example.com 6
!renewclient email@example.com 6
!setnote email@example.com your note here
!note email@example.com
!exportcsv
!monthlyreminder
!removeclient email@example.com confirm
!resetmonth confirm

Slash versions are also available for many commands.`
      );
    }

    if (command === '!addclient') {
      return handleAddClient(
        message,
        args[1],
        args[2],
        args[3],
        args[4],
        args.slice(5).join(' ')
      );
    }

    if (command === '!listclients') {
      return handleListClients(message, args[1], args[2]);
    }

    if (command === '!searchclient') {
      return handleSearchClient(message, args.slice(1).join(' '));
    }

    if (command === '!client') {
      return handleClient(message, args.slice(1).join(' '));
    }

    if (command === '!inactiveclients') {
      return handleInactiveClients(message, args[1], args[2]);
    }

    if (command === '!renewals') {
      return handleRenewals(message, args[1]);
    }

    if (command === '!book') {
      return handleBook(message, args[1], args[2], args[3]);
    }

    if (command === '!undosession') {
      return handleUndoSession(message, args[1]);
    }

    if (command === '!setphone') {
      return handleSetPhone(message, args[1], args[2]);
    }

    if (command === '!setused') {
      return handleSetUsed(message, args[1], args[2]);
    }

    if (command === '!setbookedmonth') {
      return handleSetBookedMonth(message, args[1], args[2]);
    }

    if (command === '!setsessions' || command === '!settotal') {
      return handleSetTotal(message, args[1], args[2]);
    }

    if (command === '!renewclient') {
      return handleRenewClient(message, args[1], args[2]);
    }

    if (command === '!setnote') {
      return handleSetNote(message, args[1], args.slice(2).join(' '));
    }

    if (command === '!note') {
      return handleNote(message, args[1]);
    }

    if (command === '!exportcsv') {
      return handleExportCsv(message);
    }

    if (command === '!removeclient') {
      return handleRemoveClient(message, args[1], args[2]);
    }

    if (command === '!resetmonth') {
      return handleResetMonth(message, args[1]);
    }
  } catch (error) {
    console.error(error);
    return message.reply('Something went wrong.');
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    await resetMonthlyCountsIfNeeded();

    if (interaction.commandName === 'client') {
      return handleClient(interaction, interaction.options.getString('query', true));
    }

    if (interaction.commandName === 'searchclient') {
      return handleSearchClient(interaction, interaction.options.getString('query', true));
    }

    if (interaction.commandName === 'listclients') {
      return handleListClients(
        interaction,
        interaction.options.getInteger('limit') || 20,
        interaction.options.getInteger('page') || 1
      );
    }

    if (interaction.commandName === 'inactiveclients') {
      return handleInactiveClients(
        interaction,
        interaction.options.getInteger('limit') || 20,
        interaction.options.getInteger('page') || 1
      );
    }

    if (interaction.commandName === 'renewals') {
      return handleRenewals(interaction, interaction.options.getInteger('limit') || 20);
    }

    if (interaction.commandName === 'addclient') {
      return handleAddClient(
        interaction,
        interaction.options.getString('name', true),
        interaction.options.getString('phone', true),
        interaction.options.getString('email', true),
        interaction.options.getInteger('total_sessions') || 6,
        interaction.options.getString('notes') || ''
      );
    }

    if (interaction.commandName === 'renewclient') {
      return handleRenewClient(
        interaction,
        interaction.options.getString('email', true),
        interaction.options.getInteger('total') || 6
      );
    }

    if (interaction.commandName === 'setused') {
      return handleSetUsed(
        interaction,
        interaction.options.getString('email', true),
        interaction.options.getInteger('used', true)
      );
    }

    if (interaction.commandName === 'setbookedmonth') {
      return handleSetBookedMonth(
        interaction,
        interaction.options.getString('email', true),
        interaction.options.getInteger('count', true)
      );
    }

    if (interaction.commandName === 'settotal') {
      return handleSetTotal(
        interaction,
        interaction.options.getString('email', true),
        interaction.options.getInteger('total', true)
      );
    }

    if (interaction.commandName === 'setnote') {
      return handleSetNote(
        interaction,
        interaction.options.getString('email', true),
        interaction.options.getString('note', true)
      );
    }

    if (interaction.commandName === 'exportcsv') {
      return handleExportCsv(interaction);
    }
  } catch (error) {
    console.error(error);

    if (!interaction.replied && !interaction.deferred) {
      return interaction.reply({
        content: 'Something went wrong.',
        ephemeral: true
      });
    }
  }
});

client.login(BOT_TOKEN);
