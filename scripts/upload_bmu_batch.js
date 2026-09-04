import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '..');
const envPath = path.join(workspaceRoot, '.env');
const transcriptPath = path.join(process.env.HOME || process.env.USERPROFILE, 'AppData', 'Roaming', 'Code', 'User', 'workspaceStorage', '9cad5a10dc1addbece6f1b7d8fc82490', 'GitHub.copilot-chat', 'transcripts', 'f7eaa3a0-3a64-46b8-b46b-c3fadeea14cf.jsonl');

function loadEnv(filePath) {
  const text = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
}

function findMessageContent() {
  if (!fs.existsSync(transcriptPath)) {
    throw new Error(`Transcript not found at ${transcriptPath}`);
  }

  const lines = fs.readFileSync(transcriptPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      const content = obj?.data?.content ?? obj?.content ?? '';
      if (typeof content === 'string' && content.toLowerCase().includes('import 125 bmu')) {
        return content;
      }
    } catch {
      // ignore non-JSON lines
    }
  }

  throw new Error('BMU import message not found in transcript');
}

function extractSerials(content) {
  const matches = (content.match(/\b[0-9A-Z]{8,}\b/g) || []).map((s) => s.toUpperCase());
  const deduped = [...new Set(matches)];
  const likely = deduped.filter((s) => /^(?:47|48|49)[0-9A-F]{7,}$/.test(s) || /HS/.test(s));
  return likely;
}

async function main() {
  const env = loadEnv(envPath);
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('Supabase URL/service key missing in .env');
  }

  const content = findMessageContent();
  const serials = extractSerials(content);
  const target = serials.slice(0, 125);

  console.log(JSON.stringify({
    transcript: transcriptPath,
    rawMatches: serials.length,
    uniqueMatches: new Set(serials).size,
    targetCount: target.length,
    first10: target.slice(0, 10),
    last10: target.slice(-10),
  }, null, 2));

  if (target.length !== 125) {
    throw new Error(`Expected 125 BMU serials, found ${target.length}`);
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const rows = target.map((serialNumber, index) => ({
    id: `bmu-${Date.now()}-${String(index + 1).padStart(4, '0')}`,
    serial_number: serialNumber,
    model: 'Power2Go BMU-X1',
    manufacturer: 'Hawasu',
    batch_number: '02',
    protocol: 'CAN',
    status: 'AVAILABLE',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));

  const { data, error } = await supabase.from('bmu_units').upsert(rows, { onConflict: 'serial_number', ignoreDuplicates: false }).select();
  if (error) {
    throw new Error(error.message || 'Failed to upsert BMU batch');
  }

  console.log(JSON.stringify({ inserted: data.length, sample: data.slice(0, 3) }, null, 2));
}

main().catch((err) => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
