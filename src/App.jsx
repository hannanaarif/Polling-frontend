import { useState, useEffect } from 'react';
import PollApp from './PollApp';
import './App.css';

function App() {
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch('/api');
        const data = await response.json();
        setMessage(data.message);
      } catch (error) {
        console.error('Error fetching data:', error);
        setMessage('Error connecting to server');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  return (
    <div className="app">
      <h1>LLUMO App</h1>
      <div className="card">
        {loading ? (
          <p>Loading...</p>
        ) : (
          <p className='card-title'>{message}</p>
        )}
      </div>
      
      <PollApp />
    </div>
  );
}

export default App; 