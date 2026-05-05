import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'arguide_ai.db');

let db;

export function initDatabase() {
  db = new Database(DB_PATH);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      technician_name TEXT,
      expert_name TEXT,
      location TEXT,
      repair_type TEXT,
      started_at INTEGER,
      ended_at INTEGER,
      duration_seconds INTEGER,
      steps_completed INTEGER,
      steps_total INTEGER,
      ai_alerts_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS ai_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      alert_type TEXT,
      severity TEXT,
      title TEXT,
      description TEXT,
      confidence REAL,
      frame_timestamp INTEGER,
      acknowledged INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS sop_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      sop_id TEXT,
      step_number INTEGER,
      step_name TEXT,
      completed INTEGER DEFAULT 0,
      completed_at INTEGER,
      ai_validated INTEGER DEFAULT 0,
      confidence REAL,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS session_frames (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      captured_at INTEGER,
      analysis_result TEXT,
      anomalies_detected TEXT,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS sop_definitions (
      id TEXT PRIMARY KEY,
      name TEXT,
      description TEXT,
      repair_type TEXT,
      expected_duration_min INTEGER,
      expected_duration_max INTEGER,
      steps TEXT
    );
  `);

  seedSOPDefinitions();
  console.log('[AI-DB] Database initialized at', DB_PATH);
  return db;
}

function seedSOPDefinitions() {
  const existing = db.prepare('SELECT COUNT(*) as count FROM sop_definitions').get();
  if (existing.count > 0) return;

  const sops = [
    {
      id: 'SOP-HYD-001',
      name: 'Hydraulic Valve Replacement',
      description: 'Standard procedure for replacing hydraulic control valves',
      repair_type: 'hydraulic',
      expected_duration_min: 20,
      expected_duration_max: 45,
      steps: JSON.stringify([
        { number: 1, name: 'Depressurize hydraulic system', critical: true },
        { number: 2, name: 'Isolate the valve using shutoff valves', critical: true },
        { number: 3, name: 'Drain residual fluid', critical: false },
        { number: 4, name: 'Remove mounting bolts (note torque spec)', critical: false },
        { number: 5, name: 'Inspect O-ring seating surfaces', critical: true },
        { number: 6, name: 'Install new valve with new O-rings', critical: true },
        { number: 7, name: 'Torque bolts to spec (check manual)', critical: true },
        { number: 8, name: 'Pressure test after installation', critical: true },
        { number: 9, name: 'Check for leaks at all joints', critical: true },
        { number: 10, name: 'Document and sign off', critical: false }
      ])
    },
    {
      id: 'SOP-ENG-001',
      name: 'Engine Assembly Check',
      description: 'Pre-flight engine component verification',
      repair_type: 'engine',
      expected_duration_min: 30,
      expected_duration_max: 90,
      steps: JSON.stringify([
        { number: 1, name: 'Visual inspection of all external components', critical: true },
        { number: 2, name: 'Check all fastener torques', critical: true },
        { number: 3, name: 'Verify fuel line connections', critical: true },
        { number: 4, name: 'Inspect for oil leaks', critical: true },
        { number: 5, name: 'Check sensor connections', critical: false },
        { number: 6, name: 'Run startup diagnostics', critical: true },
        { number: 7, name: 'Document findings', critical: false }
      ])
    },
    {
      id: 'SOP-AVI-001',
      name: 'Avionics Systems Check',
      description: 'Pre-flight avionics verification procedure',
      repair_type: 'avionics',
      expected_duration_min: 25,
      expected_duration_max: 60,
      steps: JSON.stringify([
        { number: 1, name: 'Power on all avionics systems', critical: true },
        { number: 2, name: 'Verify communication systems', critical: true },
        { number: 3, name: 'Check navigation instruments', critical: true },
        { number: 4, name: 'Test autopilot disconnect', critical: true },
        { number: 5, name: 'Verify warning systems', critical: true },
        { number: 6, name: 'Check display integrity', critical: false },
        { number: 7, name: 'Log and sign off', critical: false }
      ])
    }
  ];

  const insert = db.prepare(`
    INSERT INTO sop_definitions (id, name, description, repair_type, expected_duration_min, expected_duration_max, steps)
    VALUES (@id, @name, @description, @repair_type, @expected_duration_min, @expected_duration_max, @steps)
  `);

  for (const sop of sops) {
    insert.run(sop);
  }
}

export function getDB() {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}
