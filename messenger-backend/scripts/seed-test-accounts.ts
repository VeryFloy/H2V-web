import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool    = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma  = new PrismaClient({ adapter });

const TEST_USERS = [
  { nickname: 'test1', password: 'test1' },
  { nickname: 'test2', password: 'test2' },
];

async function main() {
  for (const u of TEST_USERS) {
    const hash = await bcrypt.hash(u.password, 10);
    const user = await prisma.user.upsert({
      where:  { nickname: u.nickname },
      update: { passwordHash: hash },
      create: { nickname: u.nickname, passwordHash: hash },
    });
    console.log(`[Seed] ${user.nickname} — ok (id: ${user.id})`);
  }
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
