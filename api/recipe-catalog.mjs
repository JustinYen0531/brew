import { publicMorningBrewCatalog } from '../morning-brew-recipes.mjs';

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: '只接受 GET 請求。' });
  return res.status(200).json(publicMorningBrewCatalog());
}
