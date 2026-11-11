import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@crelune/shared', '@crelune/ui', '@crelune/database'],
  serverExternalPackages: ['sharp'],
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
