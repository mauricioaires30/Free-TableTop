import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// GitHub Pages serve o site em /<nome-do-repo>/. Mude VITE_BASE se o repositório tiver outro nome.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/free-tabletop/',
  plugins: [svelte()],
});
