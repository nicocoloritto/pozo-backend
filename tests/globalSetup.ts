import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

const raiz = join(__dirname, '..');

function borrarBaseDeTests() {
  for (const archivo of ['test.db', 'test.db-journal']) rmSync(join(raiz, archivo), { force: true });
}

// Los tests usan su propia base SQLite (test.db), nunca la de desarrollo: se borra y se
// recrea desde el schema en cada corrida.
export default function setup() {
  borrarBaseDeTests();
  execSync('npx prisma db push', {
    env: { ...process.env, DATABASE_URL: 'file:./test.db' },
    stdio: 'ignore',
  });
  return () => {
    borrarBaseDeTests();
    rmSync(join(__dirname, '..', 'uploads-test'), { recursive: true, force: true });
  };
}
