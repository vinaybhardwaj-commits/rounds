#!/bin/bash
# ============================================
# Rounds — Bootstrap Script
# ============================================
# Usage: chmod +x scripts/bootstrap.sh && ./scripts/bootstrap.sh
#
# Prerequisites:
#   - Node.js 18+
#   - A Neon Postgres database (via Vercel or neon.tech)
#   - Google OAuth credentials (console.cloud.google.com)

set -e

echo "🏥 Rounds — Bootstrap"
echo "====================="
echo ""

# 1. Check Node version
NODE_VERSION=$(node -v | cut -d'.' -f1 | sed 's/v//')
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "❌ Node.js 18+ required (found v$NODE_VERSION)"
  exit 1
fi
echo "✅ Node.js $(node -v)"

# 2. Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm install

# 3. Check .env.local
if [ ! -f .env.local ]; then
  echo ""
  echo "⚠️  No .env.local found. Copying from .env.example..."
  cp .env.example .env.local
  echo "📝 Please edit .env.local with your actual values:"
  echo "   - POSTGRES_URL (from Vercel/Neon dashboard)"
  echo "   - GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET"
  echo "   - NEXTAUTH_SECRET (run: openssl rand -base64 32)"
  echo ""
  echo "   Then re-run this script."
  exit 0
fi

# 4. Run database migration
echo ""
echo "🗄️  Running database migration..."
npx tsx scripts/migrate.ts

# 5. Seed departments
echo ""
echo "🌱 Seeding departments..."
npx tsx scripts/seed-departments.ts

# 6. Done
echo ""
echo "============================================"
echo "🎉 Rounds is ready!"
echo ""
echo "   Start dev server:  npm run dev"
echo "   Open:              http://localhost:3000"
echo ""
echo "   First login with your @even.in Google account."
echo "   Then go to /admin to manage profiles."
echo "============================================"
