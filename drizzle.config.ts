import {defineConfig} from 'drizzle-kit';
export default defineConfig({schema:'./hosted/schema.ts',out:'./drizzle',dialect:'sqlite'});
