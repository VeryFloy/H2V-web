import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool    = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma  = new PrismaClient({ adapter });

async function main() {
  const u = await prisma.user.findUnique({ where: { nickname: 'test1' } });
  console.log({ id: u?.id, nickname: u?.nickname, hasHash: !!u?.passwordHash, hash: u?.passwordHash?.slice(0, 20) });
}

main().finally(() => prisma.$disconnect());
