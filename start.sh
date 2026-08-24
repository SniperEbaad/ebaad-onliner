#!/bin/bash
echo "🚀 Running prisma generate..."
npx prisma generate
echo "✅ Prisma generate complete!"
echo "🚀 Starting server..."
node server.js
