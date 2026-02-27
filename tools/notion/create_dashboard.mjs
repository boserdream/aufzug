#!/usr/bin/env node

const NOTION_VERSION = '2022-06-28';
const API_BASE = 'https://api.notion.com/v1';

function parseArgs(argv) {
  const args = { title: 'Moritz OS Dashboard' };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--parent' || token === '-p') {
      args.parent = argv[i + 1];
      i += 1;
    } else if (token === '--title' || token === '-t') {
      args.title = argv[i + 1];
      i += 1;
    } else if (token === '--help' || token === '-h') {
      args.help = true;
    }
  }
  return args;
}

function extractId(input) {
  if (!input) return null;

  const clean = input.trim();
  const maybeDirect = clean.replace(/-/g, '');
  if (/^[0-9a-fA-F]{32}$/.test(maybeDirect)) {
    return `${maybeDirect.slice(0, 8)}-${maybeDirect.slice(8, 12)}-${maybeDirect.slice(12, 16)}-${maybeDirect.slice(16, 20)}-${maybeDirect.slice(20)}`.toLowerCase();
  }

  const matches = clean.match(/[0-9a-fA-F]{32}/g);
  if (!matches || matches.length === 0) return null;
  const raw = matches[matches.length - 1];
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`.toLowerCase();
}

function usage() {
  return `
Usage:
  NOTION_TOKEN=secret_xxx node tools/notion/create_dashboard.mjs --parent <notion_page_url_or_id> [--title "Moritz OS Dashboard"]

Example:
  NOTION_TOKEN=secret_xxx npm run notion:dashboard -- --parent "https://www.notion.so/..."
`;
}

async function notionRequest({ token, path, method = 'GET', body }) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Notion API ${method} ${path} failed (${response.status}): ${errorText}`);
  }

  return response.json();
}

function richText(content, options = {}) {
  return {
    type: 'text',
    text: { content },
    annotations: options.annotations,
  };
}

function paragraph(text) {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: { rich_text: [richText(text)] },
  };
}

function heading2(text) {
  return {
    object: 'block',
    type: 'heading_2',
    heading_2: { rich_text: [richText(text)] },
  };
}

function heading3(text) {
  return {
    object: 'block',
    type: 'heading_3',
    heading_3: { rich_text: [richText(text)] },
  };
}

function toDo(text, checked = false) {
  return {
    object: 'block',
    type: 'to_do',
    to_do: {
      rich_text: [richText(text)],
      checked,
    },
  };
}

function callout(text, emoji = '🎯') {
  return {
    object: 'block',
    type: 'callout',
    callout: {
      icon: { type: 'emoji', emoji },
      rich_text: [richText(text)],
    },
  };
}

function divider() {
  return {
    object: 'block',
    type: 'divider',
    divider: {},
  };
}

function toggle(title, children = []) {
  return {
    object: 'block',
    type: 'toggle',
    toggle: {
      rich_text: [richText(title)],
      children,
    },
  };
}

function linkToDatabase(databaseId) {
  return {
    object: 'block',
    type: 'link_to_page',
    link_to_page: {
      type: 'database_id',
      database_id: databaseId,
    },
  };
}

async function appendBlocks({ token, blockId, children }) {
  await notionRequest({
    token,
    path: `/blocks/${blockId}/children`,
    method: 'PATCH',
    body: { children },
  });
}

async function createDatabase({ token, parentPageId, title, properties }) {
  return notionRequest({
    token,
    path: '/databases',
    method: 'POST',
    body: {
      parent: { type: 'page_id', page_id: parentPageId },
      title: [
        {
          type: 'text',
          text: { content: title },
        },
      ],
      properties,
    },
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage().trim());
    process.exit(0);
  }

  const token = process.env.NOTION_TOKEN;
  if (!token) {
    console.error('Missing NOTION_TOKEN environment variable.');
    console.error(usage().trim());
    process.exit(1);
  }

  const parentPageId = extractId(args.parent);
  if (!parentPageId) {
    console.error('Could not parse --parent page id.');
    console.error(usage().trim());
    process.exit(1);
  }

  const dashboard = await notionRequest({
    token,
    path: '/pages',
    method: 'POST',
    body: {
      parent: { type: 'page_id', page_id: parentPageId },
      icon: { type: 'emoji', emoji: '🎯' },
      properties: {
        title: {
          title: [
            {
              type: 'text',
              text: { content: args.title },
            },
          ],
        },
      },
    },
  });

  const dashboardId = dashboard.id;

  await appendBlocks({
    token,
    blockId: dashboardId,
    children: [
      callout('Fokus: Erledige heute die 3 wichtigsten Dinge.', '🚀'),
      heading2('Schnellaktionen'),
      toDo('Neue Bewerbung anlegen'),
      toDo('Neue Aufgabe anlegen'),
      toDo('Termin erfassen'),
      toDo('Inbox-Notiz festhalten'),
      divider(),
      heading2('Heute'),
      heading3('Top 3'),
      toDo('Wichtigste Aufgabe 1'),
      toDo('Wichtigste Aufgabe 2'),
      toDo('Wichtigste Aufgabe 3'),
      paragraph('Deep Work Block: 09:00 - 11:00'),
      divider(),
      heading2('Bewerbungs-Hub'),
      paragraph('Nutze die Datenbanken unten fuer Pipeline, Follow-ups und Deadlines.'),
      divider(),
      heading2('Wochenreview'),
      toggle('Was lief gut?', [paragraph('Kurz reflektieren und festhalten.')]),
      toggle('Was blockiert?', [paragraph('Hindernisse und naechste Gegenmassnahme notieren.')]),
      toggle('Top 3 fuer naechste Woche', [
        toDo('Punkt 1'),
        toDo('Punkt 2'),
        toDo('Punkt 3'),
      ]),
      divider(),
      heading2('Datenbanken'),
    ],
  });

  const bewerbungen = await createDatabase({
    token,
    parentPageId: dashboardId,
    title: 'Bewerbungen',
    properties: {
      Firma: { title: {} },
      Rolle: { rich_text: {} },
      Status: {
        select: {
          options: [
            { name: 'Idee', color: 'gray' },
            { name: 'In Vorbereitung', color: 'yellow' },
            { name: 'Versendet', color: 'blue' },
            { name: 'Interview', color: 'orange' },
            { name: 'Angebot', color: 'green' },
            { name: 'Absage', color: 'red' },
          ],
        },
      },
      Bewerbungsdatum: { date: {} },
      FollowUp: { date: {} },
      Quelle: {
        select: {
          options: [
            { name: 'LinkedIn', color: 'blue' },
            { name: 'StepStone', color: 'brown' },
            { name: 'Karriereportal', color: 'purple' },
            { name: 'Netzwerk', color: 'green' },
            { name: 'Sonstiges', color: 'gray' },
          ],
        },
      },
      Prioritaet: {
        select: {
          options: [
            { name: 'Hoch', color: 'red' },
            { name: 'Mittel', color: 'yellow' },
            { name: 'Niedrig', color: 'gray' },
          ],
        },
      },
      UnterlagenVollstaendig: { checkbox: {} },
      Link: { url: {} },
      Notizen: { rich_text: {} },
    },
  });

  const aufgaben = await createDatabase({
    token,
    parentPageId: dashboardId,
    title: 'Aufgaben',
    properties: {
      Aufgabe: { title: {} },
      Status: {
        select: {
          options: [
            { name: 'Offen', color: 'gray' },
            { name: 'In Arbeit', color: 'blue' },
            { name: 'Warten', color: 'yellow' },
            { name: 'Erledigt', color: 'green' },
          ],
        },
      },
      Prioritaet: {
        select: {
          options: [
            { name: 'Hoch', color: 'red' },
            { name: 'Mittel', color: 'yellow' },
            { name: 'Niedrig', color: 'gray' },
          ],
        },
      },
      Faellig: { date: {} },
      Bereich: {
        select: {
          options: [
            { name: 'Bewerbung', color: 'blue' },
            { name: 'Admin', color: 'brown' },
            { name: 'Lernen', color: 'purple' },
            { name: 'Privat', color: 'green' },
          ],
        },
      },
      Bewerbung: {
        relation: {
          database_id: bewerbungen.id,
          type: 'single_property',
          single_property: {},
        },
      },
    },
  });

  const termine = await createDatabase({
    token,
    parentPageId: dashboardId,
    title: 'Termine',
    properties: {
      Termin: { title: {} },
      Datum: { date: {} },
      Typ: {
        select: {
          options: [
            { name: 'Interview', color: 'orange' },
            { name: 'Telefonat', color: 'blue' },
            { name: 'Deadline', color: 'red' },
            { name: 'Sonstiges', color: 'gray' },
          ],
        },
      },
      Bewerbung: {
        relation: {
          database_id: bewerbungen.id,
          type: 'single_property',
          single_property: {},
        },
      },
      Notizen: { rich_text: {} },
    },
  });

  const notizen = await createDatabase({
    token,
    parentPageId: dashboardId,
    title: 'Notizen',
    properties: {
      Titel: { title: {} },
      Kategorie: {
        select: {
          options: [
            { name: 'Inbox', color: 'gray' },
            { name: 'Bewerbung', color: 'blue' },
            { name: 'Idee', color: 'yellow' },
            { name: 'Journal', color: 'green' },
            { name: 'Lernen', color: 'purple' },
          ],
        },
      },
      Bewerbung: {
        relation: {
          database_id: bewerbungen.id,
          type: 'single_property',
          single_property: {},
        },
      },
      Erstellt: { created_time: {} },
    },
  });

  await appendBlocks({
    token,
    blockId: dashboardId,
    children: [
      linkToDatabase(bewerbungen.id),
      linkToDatabase(aufgaben.id),
      linkToDatabase(termine.id),
      linkToDatabase(notizen.id),
      callout('Hinweis: Datenbank-Views/Filter (Heute, Pipeline, Follow-up) werden in Notion aktuell am besten manuell als Saved Views erstellt.', 'ℹ️'),
    ],
  });

  console.log('Dashboard erstellt.');
  console.log(`Dashboard: ${dashboard.url}`);
  console.log(`Bewerbungen: ${bewerbungen.url}`);
  console.log(`Aufgaben: ${aufgaben.url}`);
  console.log(`Termine: ${termine.url}`);
  console.log(`Notizen: ${notizen.url}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
