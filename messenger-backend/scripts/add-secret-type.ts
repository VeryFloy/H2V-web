import 'dotenv/config';
import { prisma } from '../src/config/database';
async function main() {
  await prisma.$executeRawUnsafe(`ALTER TYPE "ChatType" ADD VALUE IF NOT EXISTS 'SECRET'`);
  console.log('Done: SECRET added to ChatType enum');
}
main().then(() => prisma.$disconnect()).catch(e => { console.error(e); prisma.$disconnect(); process.exit(1); });
