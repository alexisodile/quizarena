// Ajouter ces lignes dans server/index.js après "app.use(express.json())"
// Ce fichier montre la route proxy à intégrer

// ─── PROXY CLAUDE API ─────────────────────────────────────────────────────────
// Permet au frontend d'appeler Claude sans exposer la clé API
app.post('/api/claude', async (req, res) => {
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY non configurée' });
  }

  const { prompt } = req.body;
  const categories = ['Histoire','Géographie','Sciences','Art & Culture','Sport','Cinéma & Séries','Musique','Gastronomie','Technologie','Littérature','Politique mondiale','Nature & Animaux'];

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 3000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) throw new Error('Anthropic API error: ' + response.status);
    const data = await response.json();
    const text = data.content.map(b => b.text || '').join('');
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    res.json(parsed);
  } catch (err) {
    console.error('Claude proxy error:', err);
    res.status(500).json({ error: err.message });
  }
});
