const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const CLIENTS_FILE = './clients.json';

// PUT YOUR TOKEN HERE
const BOT_TOKEN = process.env.BOT_TOKEN;

// OPTIONAL: put a specific channel ID here if you only want updates sent there.
// Leave as "" to let the bot reply in whatever channel you used the command in.
const BOOKING_CHANNEL_ID = "";

// ---------- FILE HELPERS ----------

function ensureClientsFile() {
  if (!fs.existsSync(CLIENTS_FILE)) {
    fs.writeFileSync(CLIENTS_FILE, '[]');
  }
}

function loadClients() {
  ensureClientsFile();
  return JSON.parse(fs.readFileSync(CLIENTS_FILE, 'utf8'));
}

function saveClients(clients) {
  fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));
}

// ---------- MONTH RESET HELPERS ----------

function currentMonthKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function resetMonthlyCountsIfNeeded() {
  const clients = loadClients();
  const thisMonth = currentMonthKey();
  let changed = false;

  for (const client of clients) {
    if (!client.lastResetMonth) {
      client.lastResetMonth = thisMonth;
      if (typeof client.bookedThisMonth !== 'number') {
        client.bookedThisMonth = 0;
      }
      changed = true;
      continue;
    }

    if (client.lastResetMonth !== thisMonth) {
      client.bookedThisMonth = 0;
      client.lastResetMonth = thisMonth;
      changed = true;
    }
  }

  if (changed) {
    saveClients(clients);
  }
}

// Check once every hour
setInterval(() => {
  try {
    resetMonthlyCountsIfNeeded();
  } catch (error) {
    console.error('Monthly reset error:', error);
  }
}, 60 * 60 * 1000);

// ---------- FORMATTING ----------

function formatBookingMessage(clientData, bookingDate, bookingTime) {
  const sessionsRemaining = clientData.sessionsTotal - clientData.sessionsUsed;

  return (
`${clientData.name} has booked for ${bookingDate} at ${bookingTime}.
Sessions remaining: ${sessionsRemaining}

Email: ${clientData.email}
Phone: ${clientData.phone}
Booked this month: ${clientData.bookedThisMonth}`
  );
}

async function sendBookingUpdate(message, text) {
  if (BOOKING_CHANNEL_ID) {
    const channel = await client.channels.fetch(BOOKING_CHANNEL_ID).catch(() => null);
    if (channel) {
      return channel.send(text);
    }
  }

  return message.reply(text);
}

// ---------- BOT EVENTS ----------

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  resetMonthlyCountsIfNeeded();
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  resetMonthlyCountsIfNeeded();

  const args = message.content.trim().split(' ');
  const command = args[0]?.toLowerCase();

  // !addclient Name phone email totalSessions
  if (command === '!addclient') {
    const name = args[1];
    const phone = args[2];
    const email = args[3]?.toLowerCase();
    const totalSessions = Number(args[4] || 6);

    if (!name || !phone || !email) {
      return message.reply('Usage: !addclient Name phone email@example.com totalSessions');
    }

    const clients = loadClients();
    const exists = clients.find(c => c.email === email);

    if (exists) {
      return message.reply('Client already exists.');
    }

    clients.push({
      name,
      phone,
      email,
      sessionsUsed: 0,
      sessionsTotal: totalSessions,
      bookedThisMonth: 0,
      lastResetMonth: currentMonthKey()
    });

    saveClients(clients);
    return message.reply(`Added ${name}`);
  }

  // !listclients
  if (command === '!listclients') {
    const clients = loadClients();

    if (clients.length === 0) {
      return message.reply('No clients yet.');
    }

    const text = clients.map(c => {
      const remaining = c.sessionsTotal - c.sessionsUsed;
      return `${c.name} | ${c.email} | Used: ${c.sessionsUsed}/${c.sessionsTotal} | Remaining: ${remaining} | This month: ${c.bookedThisMonth}`;
    }).join('\n');

    return message.reply(text);
  }

  // !client email@example.com
  if (command === '!client') {
    const email = args[1]?.toLowerCase();

    if (!email) {
      return message.reply('Usage: !client email@example.com');
    }

    const clients = loadClients();
    const clientData = clients.find(c => c.email === email);

    if (!clientData) {
      return message.reply('Client not found.');
    }

    const remaining = clientData.sessionsTotal - clientData.sessionsUsed;

    return message.reply(
`${clientData.name}
Phone: ${clientData.phone}
Email: ${clientData.email}
Sessions Used: ${clientData.sessionsUsed}/${clientData.sessionsTotal}
Sessions Remaining: ${remaining}
Booked This Month: ${clientData.bookedThisMonth}`
    );
  }

  // !book email@example.com April-18-2026 1:00PM
  if (command === '!book') {
    const email = args[1]?.toLowerCase();
    const bookingDate = args[2];
    const bookingTime = args[3];

    if (!email || !bookingDate || !bookingTime) {
      return message.reply('Usage: !book email@example.com April-18-2026 1:00PM');
    }

    const clients = loadClients();
    const clientData = clients.find(c => c.email === email);

    if (!clientData) {
      return message.reply('Client not found.');
    }

    clientData.sessionsUsed += 1;
    clientData.bookedThisMonth += 1;

    saveClients(clients);

    const text = formatBookingMessage(clientData, bookingDate, bookingTime);
    return sendBookingUpdate(message, text);
  }

  // !undosession email@example.com
  if (command === '!undosession') {
    const email = args[1]?.toLowerCase();

    if (!email) {
      return message.reply('Usage: !undosession email@example.com');
    }

    const clients = loadClients();
    const clientData = clients.find(c => c.email === email);

    if (!clientData) {
      return message.reply('Client not found.');
    }

    if (clientData.sessionsUsed > 0) {
      clientData.sessionsUsed -= 1;
    }

    if (clientData.bookedThisMonth > 0) {
      clientData.bookedThisMonth -= 1;
    }

    saveClients(clients);
    return message.reply(`Removed one booking/session from ${clientData.name}`);
  }

  // !setphone email@example.com 416-555-1234
  if (command === '!setphone') {
    const email = args[1]?.toLowerCase();
    const phone = args[2];

    if (!email || !phone) {
      return message.reply('Usage: !setphone email@example.com 416-555-1234');
    }

    const clients = loadClients();
    const clientData = clients.find(c => c.email === email);

    if (!clientData) {
      return message.reply('Client not found.');
    }

    clientData.phone = phone;
    saveClients(clients);
    return message.reply(`Updated phone for ${clientData.name}`);
  }

  // !setsessions email@example.com 6
  if (command === '!setsessions') {
    const email = args[1]?.toLowerCase();
    const total = Number(args[2]);

    if (!email || Number.isNaN(total)) {
      return message.reply('Usage: !setsessions email@example.com 6');
    }

    const clients = loadClients();
    const clientData = clients.find(c => c.email === email);

    if (!clientData) {
      return message.reply('Client not found.');
    }

    clientData.sessionsTotal = total;
    saveClients(clients);
    return message.reply(`Updated total sessions for ${clientData.name} to ${total}`);
  }

  // !removeclient email@example.com
  if (command === '!removeclient') {
    const email = args[1]?.toLowerCase();

    if (!email) {
      return message.reply('Usage: !removeclient email@example.com');
    }

    const clients = loadClients();
    const filtered = clients.filter(c => c.email !== email);

    if (filtered.length === clients.length) {
      return message.reply('Client not found.');
    }

    saveClients(filtered);
    return message.reply(`Removed ${email}`);
  }

  // !resetmonth
  if (command === '!resetmonth') {
    const clients = loadClients();

    for (const client of clients) {
      client.bookedThisMonth = 0;
      client.lastResetMonth = currentMonthKey();
    }

    saveClients(clients);
    return message.reply('Monthly booking counts reset.');
  }

  // !helpbot
  if (command === '!helpbot') {
    return message.reply(
`Commands:
!addclient Name phone email@example.com totalSessions
!listclients
!client email@example.com
!book email@example.com April-18-2026 1:00PM
!undosession email@example.com
!setphone email@example.com 416-555-1234
!setsessions email@example.com 6
!removeclient email@example.com
!resetmonth`
    );
  }
});

client.login(BOT_TOKEN);