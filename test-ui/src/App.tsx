import { useState } from 'react';
import './App.css';

interface TranslationResult {
  original: string;
  translated: string;
  source: 'cache' | 'ai';
}

function App() {
  const [text, setText] = useState('China Telecom');
  const [locale, setLocale] = useState('zh');
  const [token, setToken] = useState('lKU4tZi8MvUB25tz9afwSkGGSWiY5jgD0pHhoNQ5soHgXsbveHEvKEEK0Oche98C');
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleTranslate = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch('http://localhost:8787', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token,
        },
        body: JSON.stringify({ text, locale }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Error ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      setResult(data as TranslationResult);
    } catch (err: any) {
      setError(err.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container">
      <h1>ISP Translator Test Page</h1>
      
      <div className="form-group">
        <label>API Token:</label>
        <input 
          type="text" 
          value={token} 
          onChange={(e) => setToken(e.target.value)} 
          placeholder="Enter API Token"
        />
      </div>

      <div className="form-group">
        <label>Text to Translate (max 64 chars):</label>
        <input 
          type="text" 
          value={text} 
          maxLength={64}
          onChange={(e) => setText(e.target.value)} 
          placeholder="e.g. China Mobile"
        />
        <span className="char-count">{text.length}/64</span>
      </div>

      <div className="form-group">
        <label>Target Locale:</label>
        <input 
          type="text" 
          value={locale} 
          onChange={(e) => setLocale(e.target.value)} 
          placeholder="e.g. zh, en, ja"
        />
      </div>

      <button onClick={handleTranslate} disabled={loading || !text || !locale}>
        {loading ? 'Translating...' : 'Translate'}
      </button>

      {error && <div className="error">{error}</div>}

      {result && (
        <div className="result-card">
          <h3>Result</h3>
          <p><strong>Original:</strong> {result.original}</p>
          <p><strong>Translated:</strong> {result.translated}</p>
          <p><strong>Source:</strong> <span className={`source-badge ${result.source}`}>{result.source}</span></p>
        </div>
      )}

      <div className="footer-info">
        <p>Ensure your local worker is running on <code>localhost:8787</code></p>
      </div>
    </div>
  );
}

export default App;
