import { useState, useEffect } from 'react';
import './App.css';

interface TranslationResult {
  original: string;
  translated: string;
  source: 'cache' | 'ai';
}

function App() {
  const [text, setText] = useState(() => localStorage.getItem('isp_text') || 'China Telecom');
  const [locale, setLocale] = useState(() => localStorage.getItem('isp_locale') || 'zh');
  const [token, setToken] = useState(() => localStorage.getItem('isp_token') || 'lKU4tZi8MvUB25tz9afwSkGGSWiY5jgD0pHhoNQ5soHgXsbveHEvKEEK0Oche98C');
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const isLocal = window.location.hostname === 'localhost' || 
                  window.location.hostname === '127.0.0.1' || 
                  window.location.hostname.startsWith('192.168.') ||
                  window.location.hostname.endsWith('.local');

  // Sync with localStorage
  useEffect(() => {
    localStorage.setItem('isp_text', text);
  }, [text]);

  useEffect(() => {
    localStorage.setItem('isp_locale', locale);
  }, [locale]);

  useEffect(() => {
    localStorage.setItem('isp_token', token);
  }, [token]);

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

      const data = await response.json() as TranslationResult;
      setResult(data);
      
      // Save to history
      const historyJson = localStorage.getItem('isp_history') || '[]';
      const history = JSON.parse(historyJson);
      const newHistory = [
        { ...data, timestamp: new Date().toISOString() },
        ...history
      ].slice(0, 50); // Keep last 50
      localStorage.setItem('isp_history', JSON.stringify(newHistory));
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

      <div className="button-group">
        <button className="primary-btn" onClick={handleTranslate} disabled={loading || !text || !locale}>
          {loading ? 'Translating...' : 'Translate'}
        </button>
        {isLocal && (
          <button className="secondary-btn" onClick={() => setShowEditor(!showEditor)}>
            {showEditor ? 'Hide D1 Editor' : 'Show D1 Editor'}
          </button>
        )}
      </div>

      {error && <div className="error">{error}</div>}

      {result && (
        <div className="result-card">
          <h3>Result</h3>
          <p><strong>Original:</strong> {result.original}</p>
          <p><strong>Translated:</strong> {result.translated}</p>
          <p><strong>Source:</strong> <span className={`source-badge ${result.source}`}>{result.source}</span></p>
        </div>
      )}

      {showEditor && <D1CacheEditor token={token} />}

      <div className="footer-info">
        <p>Ensure your local worker is running on <code>localhost:8787</code></p>
      </div>
    </div>
  );
}

interface CacheItem {
  id: number;
  cache_key: string;
  translated_text: string;
  created_at: string;
}

function D1CacheEditor({ token }: { token: string }) {
  const [items, setItems] = useState<CacheItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const fetchCache = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('http://localhost:8787/cache', {
        headers: { 'Authorization': token }
      });
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();
      setItems(data);
    } catch (err: any) {
      setError('Failed to fetch cache: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCache();
  }, [token]);

  const handleClearAll = async () => {
    if (!confirm('Are you sure you want to clear ALL remote cache in D1?')) return;
    
    setLoading(true);
    try {
      const response = await fetch('http://localhost:8787/cache/clear', {
        method: 'POST',
        headers: { 'Authorization': token }
      });
      if (!response.ok) throw new Error(await response.text());
      await fetchCache();
    } catch (err: any) {
      setError('Failed to clear cache: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (key: string) => {
    try {
      const response = await fetch('http://localhost:8787/cache/delete', {
        method: 'POST',
        headers: { 
          'Authorization': token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ key })
      });
      if (!response.ok) throw new Error(await response.text());
      await fetchCache();
    } catch (err: any) {
      setError('Failed to delete item: ' + err.message);
    }
  };

  const handleEdit = (item: CacheItem) => {
    setEditKey(item.cache_key);
    setEditValue(item.translated_text);
  };

  const handleSave = async () => {
    if (!editKey) return;
    try {
      const response = await fetch('http://localhost:8787/cache/update', {
        method: 'POST',
        headers: { 
          'Authorization': token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ key: editKey, text: editValue })
      });
      if (!response.ok) throw new Error(await response.text());
      setEditKey(null);
      await fetchCache();
    } catch (err: any) {
      setError('Failed to update item: ' + err.message);
    }
  };

  return (
    <div className="cache-editor">
      <div className="editor-header">
        <h3>D1 Remote Cache Editor</h3>
        <div className="header-actions">
          <button className="refresh-btn" onClick={fetchCache} disabled={loading}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
          <button className="danger-btn" onClick={handleClearAll} disabled={loading}>
            Clear All D1 Cache
          </button>
        </div>
      </div>

      {error && <div className="error" style={{ marginBottom: '1rem' }}>{error}</div>}
      
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Cache Key (MD5)</th>
              <th>Translated Text</th>
              <th>Created At</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && !loading ? (
              <tr>
                <td colSpan={4} className="empty-msg">No items in D1 cache</td>
              </tr>
            ) : (
              items.map(item => (
                <tr key={item.cache_key}>
                  <td className="key-cell">
                    <code title={item.cache_key}>{item.cache_key.substring(0, 8)}...</code>
                  </td>
                  <td className="value-cell">
                    {editKey === item.cache_key ? (
                      <textarea 
                        value={editValue} 
                        onChange={(e) => setEditValue(e.target.value)}
                      />
                    ) : (
                      <code className="value-preview">{item.translated_text}</code>
                    )}
                  </td>
                  <td className="date-cell">
                    {new Date(item.created_at).toLocaleString()}
                  </td>
                  <td className="actions-cell">
                    {editKey === item.cache_key ? (
                      <>
                        <button className="save-btn" onClick={handleSave}>Save</button>
                        <button className="cancel-btn" onClick={() => setEditKey(null)}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button className="edit-btn" onClick={() => handleEdit(item)}>Edit</button>
                        <button className="delete-btn" onClick={() => handleDelete(item.cache_key)}>Delete</button>
                      </>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default App;
