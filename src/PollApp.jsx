import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import './PollApp.css';

function PollApp() {
  // Socket connection ref
  const socketRef = useRef(null);
  
  // Load persisted user state from localStorage
  const [userState, setUserState] = useState(() => {
    const savedUserState = localStorage.getItem('pollApp_userState');
    
    if (savedUserState) {
      try {
        return JSON.parse(savedUserState);
      } catch (e) {
        console.error('Error parsing saved user state:', e);
      }
    }
    
    return {
      name: '',
      roomCode: '',
      isJoined: false
    };
  });
  
  // Room state
  const [roomState, setRoomState] = useState({
    userCount: 0,
    lastActivity: null
  });
  
  // Add state for available rooms
  const [availableRooms, setAvailableRooms] = useState([]);
  
  // Timer state
  const [timer, setTimer] = useState({
    active: false,
    seconds: 60,
    votingDisabled: false
  });
  
  // Poll states
  const [featuredPoll, setFeaturedPoll] = useState({
    question: 'Cats vs Dogs',
    options: [
      { id: 1, text: 'Cats', votes: 12 },
      { id: 2, text: 'Dogs', votes: 15 }
    ],
    hasVoted: false,
    selectedOption: null
  });
  
  const [polls, setPolls] = useState([
    {
      id: 1,
      question: 'What is your favorite programming language?',
      options: [
        { id: 1, text: 'JavaScript', votes: 0 },
        { id: 2, text: 'Python', votes: 0 },
        { id: 3, text: 'Java', votes: 0 },
        { id: 4, text: 'C#', votes: 0 }
      ]
    }
  ]);
  
  const [newPoll, setNewPoll] = useState({ question: '', options: ['', ''] });
  
  // Track which polls the current user has voted on - load from localStorage
  const [userVotes, setUserVotes] = useState(() => {
    const savedVotes = localStorage.getItem(`pollApp_votes_${userState.roomCode}`);
    
    if (savedVotes) {
      try {
        return JSON.parse(savedVotes);
      } catch (e) {
        console.error('Error parsing saved votes:', e);
      }
    }
    
    return {};
  });
  
  // Load featured poll vote state from localStorage
  const [featuredPollVote, setFeaturedPollVote] = useState(() => {
    const savedFeaturedVote = localStorage.getItem(`pollApp_featuredVote_${userState.roomCode}`);
    
    if (savedFeaturedVote) {
      try {
        return JSON.parse(savedFeaturedVote);
      } catch (e) {
        console.error('Error parsing saved featured vote:', e);
      }
    }
    
    return { hasVoted: false, selectedOption: null };
  });
  
  // Apply featuredPollVote to featuredPoll on initial load
  useEffect(() => {
    if (featuredPollVote.hasVoted) {
      setFeaturedPoll(prev => ({
        ...prev,
        hasVoted: featuredPollVote.hasVoted,
        selectedOption: featuredPollVote.selectedOption
      }));
    }
  }, []);
  
  // Persist user state to localStorage when it changes
  useEffect(() => {
    localStorage.setItem('pollApp_userState', JSON.stringify(userState));
  }, [userState]);
  
  // Persist user votes to localStorage when they change
  useEffect(() => {
    if (userState.roomCode) {
      localStorage.setItem(`pollApp_votes_${userState.roomCode}`, JSON.stringify(userVotes));
    }
  }, [userVotes, userState.roomCode]);
  
  // Persist featured poll vote state to localStorage
  useEffect(() => {
    if (userState.roomCode) {
      localStorage.setItem(`pollApp_featuredVote_${userState.roomCode}`, JSON.stringify({
        hasVoted: featuredPoll.hasVoted,
        selectedOption: featuredPoll.selectedOption
      }));
    }
  }, [featuredPoll.hasVoted, featuredPoll.selectedOption, userState.roomCode]);
  
  // Timer functionality
  useEffect(() => {
    let interval = null;
    
    if (timer.active && timer.seconds > 0) {
      interval = setInterval(() => {
        setTimer(prev => ({
          ...prev,
          seconds: prev.seconds - 1
        }));
      }, 1000);
    } else if (timer.seconds === 0 && timer.active) {
      // Voting time ended
      setTimer(prev => ({
        ...prev,
        active: false,
        votingDisabled: true
      }));
      
      showVoteNotification('Voting time has ended! Results are final.');
      
      // Notify server that voting has ended for this room
      if (socketRef.current) {
        socketRef.current.emit('votingEnded', {
          roomId: userState.roomCode
        });
      }
      
      // Save voting disabled state to localStorage
      localStorage.setItem(`pollApp_votingDisabled_${userState.roomCode}`, JSON.stringify(true));
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [timer.active, timer.seconds, userState.roomCode]);
  
  // Start timer when user joins room, check localStorage first
  useEffect(() => {
    if (userState.isJoined) {
      // Check if voting is already disabled for this room
      const savedVotingDisabled = localStorage.getItem(`pollApp_votingDisabled_${userState.roomCode}`);
      
      if (savedVotingDisabled) {
        try {
          const isDisabled = JSON.parse(savedVotingDisabled);
          
          if (isDisabled) {
            setTimer(prev => ({
              ...prev,
              active: false,
              votingDisabled: true
            }));
            return;
          }
        } catch (e) {
          console.error('Error parsing saved voting disabled state:', e);
        }
      }
      
      // Otherwise start a new timer if not already active
      if (!timer.active && !timer.votingDisabled) {
        setTimer(prev => ({
          ...prev,
          active: true,
          seconds: 60
        }));
      }
    }
  }, [userState.isJoined, userState.roomCode]);
  
  // Function to fetch available rooms
  const fetchAvailableRooms = async () => {
    try {
      const response = await fetch('https://polling-backend-77tv.onrender.com/api/rooms');
      const data = await response.json();
      
      if (data.rooms) {
        setAvailableRooms(data.rooms);
      }
    } catch (error) {
      console.error('Error fetching available rooms:', error);
    }
  };
  
  // Fetch available rooms when the component mounts and periodically
  useEffect(() => {
    fetchAvailableRooms();
    
    // Refresh room list every 30 seconds
    const interval = setInterval(fetchAvailableRooms, 30000);
    
    return () => clearInterval(interval);
  }, []);
  
  // Function to handle switching rooms
  const handleSwitchRoom = (newRoomCode) => {
    if (!userState.isJoined || !socketRef.current) return;
    
    // Send switch room event to server
    emitSocketEvent('switchRoom', {
      currentRoomId: userState.roomCode,
      newRoomId: newRoomCode,
      username: userState.name
    });
    
    // Clear votes for the previous room
    localStorage.removeItem(`pollApp_votes_${userState.roomCode}`);
    localStorage.removeItem(`pollApp_featuredVote_${userState.roomCode}`);
    localStorage.removeItem(`pollApp_votingDisabled_${userState.roomCode}`);
    
    // Update user state with new room code
    setUserState({
      ...userState,
      roomCode: newRoomCode
    });
    
    // Reset votes and polls state
    setUserVotes({});
    setRecentVotes([]);
    
    // Reset timer
    setTimer({
      active: true,
      seconds: 60,
      votingDisabled: false
    });
    
    showVoteNotification(`Switched to room ${newRoomCode}`);
  };
  
  // Add connection status state
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  
  // Add debug mode for WebSocket connection
  const [socketDebug, setSocketDebug] = useState(false);
  
  // Function to toggle WebSocket debug mode
  const toggleSocketDebug = () => {
    setSocketDebug(prev => !prev);
    showVoteNotification(`WebSocket debug mode ${!socketDebug ? 'enabled' : 'disabled'}`);
  };
  
  // Function to emit WebSocket events with debugging
  const emitSocketEvent = (eventName, data, callback) => {
    if (!socketRef.current) {
      console.error(`Cannot emit ${eventName}: Socket not connected`);
      return false;
    }
    
    if (socketDebug) {
      console.log(`Emitting event: ${eventName}`, data);
    }
    
    socketRef.current.emit(eventName, data, callback);
    return true;
  };
  
  // Socket connection setup
  useEffect(() => {
    // Only establish connection if the user has joined a room
    if (!userState.isJoined || !userState.roomCode) return;
    
    // Connect to WebSocket server with reconnection options
    const socket = io('https://polling-backend-77tv.onrender.com', {
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      transports: ['websocket', 'polling'] // Prefer WebSocket, fallback to polling
    });
    
    socketRef.current = socket;
    
    // Connection events handler setup
    const setupConnectionEvents = () => {
      socket.on('connect', () => {
        setConnectionStatus('connected');
        showVoteNotification('Connected to server!');
        
        // Join the room
        emitSocketEvent('joinRoom', {
          roomId: userState.roomCode,
          username: userState.name
        });
        
        if (socketDebug) {
          console.log('Socket connected:', socket.id);
        }
      });
      
      socket.on('disconnect', (reason) => {
        setConnectionStatus('disconnected');
        showVoteNotification(`Disconnected from server! Reason: ${reason}`);
        
        if (socketDebug) {
          console.log('Socket disconnected:', reason);
        }
      });
      
      socket.on('connect_error', (error) => {
        setConnectionStatus('error');
        console.error('Connection error:', error);
        showVoteNotification(`Connection error: ${error.message}`);
      });
      
      socket.on('reconnect_attempt', (attemptNumber) => {
        setConnectionStatus('reconnecting');
        showVoteNotification(`Reconnecting to server... (Attempt ${attemptNumber})`);
        
        if (socketDebug) {
          console.log(`Reconnection attempt ${attemptNumber}`);
        }
      });
      
      socket.on('reconnect', (attemptNumber) => {
        setConnectionStatus('connected');
        showVoteNotification(`Reconnected to server after ${attemptNumber} attempts!`);
        
        // Re-join the room after reconnection
        emitSocketEvent('joinRoom', {
          roomId: userState.roomCode,
          username: userState.name
        });
        
        if (socketDebug) {
          console.log(`Reconnected after ${attemptNumber} attempts`);
        }
      });
      
      socket.on('reconnect_failed', () => {
        setConnectionStatus('failed');
        showVoteNotification('Failed to reconnect to server. Please refresh the page.');
        
        if (socketDebug) {
          console.log('Reconnection failed');
        }
      });
      
      socket.on('error', (error) => {
        console.error('Socket error:', error);
        showVoteNotification(`Socket error: ${error.message || 'Unknown error'}`);
      });
    };
    
    // Room events handler setup
    const setupRoomEvents = () => {
      socket.on('roomData', (data) => {
        if (socketDebug) {
          console.log('Room data received:', data);
        }
        
        // Update room data from server
        setRoomState(prev => ({
          ...prev,
          userCount: data.userCount,
          lastActivity: new Date()
        }));
        
        // Update polls from server
        if (data.polls) {
          setPolls(data.polls);
        }
        
        // Update featured poll from server
        if (data.featuredPoll) {
          setFeaturedPoll(prev => ({
            ...data.featuredPoll,
            hasVoted: prev.hasVoted,
            selectedOption: prev.selectedOption
          }));
        }
      });
      
      socket.on('userJoined', (data) => {
        showVoteNotification(`${data.username} joined the room`);
        setRoomState(prev => ({
          ...prev,
          userCount: data.userCount,
          lastActivity: new Date()
        }));
        
        if (socketDebug) {
          console.log('User joined:', data);
        }
      });
      
      socket.on('userLeft', (data) => {
        showVoteNotification(`${data.username} left the room`);
        setRoomState(prev => ({
          ...prev,
          userCount: data.userCount,
          lastActivity: new Date()
        }));
        
        if (socketDebug) {
          console.log('User left:', data);
        }
      });
    };
    
    // Poll events handler setup
    const setupPollEvents = () => {
      socket.on('featuredPollUpdated', (updatedPoll) => {
        if (socketDebug) {
          console.log('Featured poll updated:', updatedPoll);
        }
        
        setFeaturedPoll(prev => ({
          ...updatedPoll,
          hasVoted: prev.hasVoted,
          selectedOption: prev.selectedOption
        }));
      });
      
      socket.on('pollsUpdated', (updatedPolls) => {
        if (socketDebug) {
          console.log('Polls updated:', updatedPolls);
        }
        
        setPolls(updatedPolls);
      });
      
      socket.on('votingEnded', () => {
        if (socketDebug) {
          console.log('Voting ended event received');
        }
        
        setTimer(prev => ({
          ...prev,
          active: false,
          votingDisabled: true
        }));
        showVoteNotification('Voting has been closed by the server');
        
        // Save voting disabled state to localStorage
        localStorage.setItem(`pollApp_votingDisabled_${userState.roomCode}`, JSON.stringify(true));
      });
      
      socket.on('voteReceived', (voteData) => {
        if (socketDebug) {
          console.log('Vote received:', voteData);
        }
        
        // Add to recent votes for animation
        setRecentVotes(prev => {
          // Keep only the last 5 votes
          const newVotes = [voteData, ...prev.slice(0, 4)];
          return newVotes;
        });
        
        // Show notification if someone else voted
        if (voteData.voter !== userState.name) {
          showVoteNotification(`${voteData.voter} voted on a poll!`);
        }
      });
      
      socket.on('voteRecorded', (response) => {
        if (socketDebug) {
          console.log('Vote recorded:', response);
        }
        
        if (response.success) {
          showVoteNotification("Your vote was recorded successfully!");
        }
      });
      
      socket.on('voteStats', (stats) => {
        if (socketDebug) {
          console.log('Vote stats received:', stats);
        }
        
        setVoteStats(stats);
      });
    };
    
    // Set up all event handlers
    setupConnectionEvents();
    setupRoomEvents();
    setupPollEvents();
    
    // Cleanup on unmount
    return () => {
      if (socketDebug) {
        console.log('Cleaning up socket connection');
      }
      
      if (socket) {
        // Remove all listeners to prevent memory leaks
        socket.removeAllListeners();
        
        // Emit leave room event before disconnecting
        socket.emit('leaveRoom', { roomId: userState.roomCode });
        socket.disconnect();
      }
    };
  }, [userState.isJoined, userState.roomCode, userState.name, socketDebug]);
  
  // Format time for display
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };
  
  // Reset timer (for admin use)
  const resetTimer = () => {
    emitSocketEvent('resetTimer', {
      roomId: userState.roomCode
    });
    
    setTimer({
      active: true,
      seconds: 60,
      votingDisabled: false
    });
    
    // Clear voting disabled state from localStorage
    localStorage.removeItem(`pollApp_votingDisabled_${userState.roomCode}`);
    
    showVoteNotification('Timer has been reset! Voting is open again.');
  };
  
  // Enhanced featured poll vote handler with WebSockets and timer check
  const handleFeaturedVote = (optionId) => {
    if (featuredPoll.hasVoted || timer.votingDisabled) {
      if (timer.votingDisabled) {
        showVoteNotification('Voting time has ended!');
      }
      return;
    }
    
    // Update local state first for immediate feedback
    setFeaturedPoll({
      ...featuredPoll,
      hasVoted: true,
      selectedOption: optionId
    });
    
    // Send vote to server via WebSocket
    emitSocketEvent('voteFeaturedPoll', {
      roomId: userState.roomCode,
      optionId
    });
  };

  const resetFeaturedPoll = () => {
    // Only reset the user's selection, not the actual votes
    setFeaturedPoll({
      ...featuredPoll,
      hasVoted: false,
      selectedOption: null
    });
  };

  // Add a state for recent votes to show animations
  const [recentVotes, setRecentVotes] = useState([]);

  // Add a state for vote statistics
  const [voteStats, setVoteStats] = useState(null);

  // Add function to request vote statistics
  const requestVoteStats = () => {
    emitSocketEvent('getVoteStats', {
      roomId: userState.roomCode
    });
  };

  // Call this periodically to update stats
  useEffect(() => {
    if (userState.isJoined) {
      // Request stats initially
      requestVoteStats();
      
      // Set up interval to update stats every 30 seconds
      const interval = setInterval(requestVoteStats, 30000);
      
      return () => clearInterval(interval);
    }
  }, [userState.isJoined, userState.roomCode]);

  // Modify the handleVote function to work with the enhanced server response
  const handleVote = (pollId, optionId) => {
    // Check if voting is disabled by timer
    if (timer.votingDisabled) {
      showVoteNotification('Voting time has ended!');
      return;
    }
    
    // Check if user has already voted on this poll
    if (userVotes[pollId]) {
      showVoteNotification("You've already voted on this poll!");
      return;
    }
    
    // Record locally that this user has voted on this poll
    setUserVotes({
      ...userVotes,
      [pollId]: optionId
    });
    
    // Send vote to server via WebSocket
    emitSocketEvent('votePoll', {
      roomId: userState.roomCode,
      pollId,
      optionId
    });
  };

  // Enhanced poll creation with WebSockets
  const handleAddPoll = () => {
    if (newPoll.question.trim() === '' || newPoll.options.some(opt => opt.trim() === '')) {
      alert('Please fill in all fields');
      return;
    }
    
    // Send new poll to server via WebSocket
    emitSocketEvent('createPoll', {
      roomId: userState.roomCode,
      question: newPoll.question,
      options: newPoll.options
    });
    
    // Reset the form
    setNewPoll({ question: '', options: ['', ''] });
    
    // Show notification
    showVoteNotification("New poll created and shared with all participants!");
  };

  // Show a temporary notification for votes
  const [notification, setNotification] = useState({ 
    message: "", 
    isVisible: false 
  });
  
  const showVoteNotification = (message) => {
    setNotification({ message, isVisible: true });
    
    // Hide notification after 3 seconds
    setTimeout(() => {
      setNotification({ message: "", isVisible: false });
    }, 3000);
  };

  const calculatePercentage = (votes, totalVotes) => {
    return totalVotes > 0 ? Math.round((votes / totalVotes) * 100) : 0;
  };

  // Reset all user votes (for testing)
  const resetAllVotes = () => {
    setUserVotes({});
    setFeaturedPoll({
      ...featuredPoll,
      hasVoted: false,
      selectedOption: null
    });
    
    // Clear votes from localStorage for this room
    localStorage.removeItem(`pollApp_votes_${userState.roomCode}`);
    localStorage.removeItem(`pollApp_featuredVote_${userState.roomCode}`);
    localStorage.removeItem(`pollApp_votingDisabled_${userState.roomCode}`);
    
    showVoteNotification("All your votes have been reset!");
  };

  // Enhanced room joining with better validation and user feedback
  const handleJoinRoom = (e) => {
    e.preventDefault();
    
    // Validate name
    if (!userState.name.trim() || userState.name.length < 2) {
      showVoteNotification('Please enter a valid name (at least 2 characters)');
      return;
    }
    
    let roomCode = userState.roomCode.trim();
    
    // Determine if creating or joining a room
    const isCreatingRoom = !roomCode;
    
    if (isCreatingRoom) {
      // Generate a random room code (6 uppercase alphanumeric characters)
      roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      showVoteNotification(`Creating new room: ${roomCode}`);
    } else {
      showVoteNotification(`Joining room: ${roomCode}`);
    }
    
    // Update user state to joined
    setUserState({
      ...userState,
      roomCode,
      isJoined: true
    });
    
    // Reset timer and votes for a fresh start
    setTimer({
      active: true,
      seconds: 60,
      votingDisabled: false
    });
    
    // Clear any existing votes for this room code
    if (isCreatingRoom) {
      localStorage.removeItem(`pollApp_votes_${roomCode}`);
      localStorage.removeItem(`pollApp_featuredVote_${roomCode}`);
      localStorage.removeItem(`pollApp_votingDisabled_${roomCode}`);
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setUserState({
      ...userState,
      [name]: value
    });
  };

  const addOption = () => {
    setNewPoll({
      ...newPoll,
      options: [...newPoll.options, '']
    });
  };

  const handleOptionChange = (index, value) => {
    const updatedOptions = [...newPoll.options];
    updatedOptions[index] = value;
    setNewPoll({
      ...newPoll,
      options: updatedOptions
    });
  };
  
  // Handle leaving room with WebSockets
  const handleLeaveRoom = () => {
    emitSocketEvent('leaveRoom', { roomId: userState.roomCode });
    
    if (socketRef.current) {
      socketRef.current.disconnect();
    }
    
    // Clear room-specific localStorage items
    const roomCode = userState.roomCode;
    localStorage.removeItem(`pollApp_votes_${roomCode}`);
    localStorage.removeItem(`pollApp_featuredVote_${roomCode}`);
    localStorage.removeItem(`pollApp_votingDisabled_${roomCode}`);
    
    setUserState({ name: '', roomCode: '', isJoined: false });
    setUserVotes({});
  };

  // Handle clear persistence button
  const clearAllPersistence = () => {
    // Clear all localStorage for the app
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('pollApp_')) {
        localStorage.removeItem(key);
      }
    });
    
    // Refresh the page to reset all states
    window.location.reload();
  };

  // Add a component to display recent votes
  const RecentVotesDisplay = () => {
    if (recentVotes.length === 0) return null;
    
    return (
      <div className="recent-votes">
        <h4>Recent Votes</h4>
        <ul>
          {recentVotes.map((vote, index) => (
            <li key={`${vote.pollId}-${vote.timestamp}`} className={index === 0 ? 'new-vote' : ''}>
              <span className="voter-name">{vote.voter}</span> voted on 
              <span className="poll-type"> {vote.pollType === 'featured' ? 'featured poll' : `poll #${vote.pollId}`}</span>
              <span className="vote-time"> {new Date(vote.timestamp).toLocaleTimeString()}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  // Add a component to display available rooms
  const AvailableRoomsDisplay = () => {
    if (availableRooms.length === 0) {
      return (
        <div className="available-rooms">
          <h4>Available Rooms</h4>
          <p>No active rooms found</p>
        </div>
      );
    }
    
    return (
      <div className="available-rooms">
        <h4>Available Rooms</h4>
        <div className="rooms-list">
          {availableRooms.map(room => (
            <div 
              key={room.id} 
              className={`room-item ${room.id === userState.roomCode ? 'current-room' : ''}`}
            >
              <div className="room-info-brief">
                <span className="room-code">{room.id}</span>
                <span className="room-users">{room.userCount} users</span>
              </div>
              <div className="room-meta">
                <span className="room-creator">Created by: {room.creator}</span>
                <span className="room-time">{room.createdTimeAgo}</span>
              </div>
              {room.id !== userState.roomCode && (
                <button 
                  className="switch-room-btn" 
                  onClick={() => handleSwitchRoom(room.id)}
                >
                  Switch to this room
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  // Add state for users in current room
  const [roomUsers, setRoomUsers] = useState([]);

  // Function to fetch users in the current room
  const fetchRoomUsers = async () => {
    if (!userState.isJoined || !userState.roomCode) return;
    
    try {
      const response = await fetch(`https://polling-backend-77tv.onrender.com/api/rooms/${userState.roomCode}/users`);
      const data = await response.json();
      
      if (data.users) {
        setRoomUsers(data.users);
      }
    } catch (error) {
      console.error('Error fetching room users:', error);
    }
  };
  
  // Fetch room users when room changes and periodically
  useEffect(() => {
    if (userState.isJoined) {
      fetchRoomUsers();
      
      const interval = setInterval(fetchRoomUsers, 15000);
      return () => clearInterval(interval);
    }
  }, [userState.isJoined, userState.roomCode]);
  
  // Component to display users in the room
  const RoomUsersDisplay = () => {
    if (!userState.isJoined) return null;
    
    return (
      <div className="room-users-display">
        <h4>Users in Room</h4>
        {roomUsers.length === 0 ? (
          <p>Loading users...</p>
        ) : (
          <ul className="users-list">
            {roomUsers.map((user, index) => (
              <li 
                key={index} 
                className={`user-item ${user.isAdmin ? 'admin' : ''} ${user.username === userState.name ? 'current-user' : ''}`}
              >
                {user.username} 
                {user.isAdmin && <span className="admin-badge">Creator</span>}
                {user.username === userState.name && <span className="you-badge">You</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  // Add socket latency state
  const [socketLatency, setSocketLatency] = useState(null);
  
  // Function to measure socket latency
  const pingServer = () => {
    if (!socketRef.current || connectionStatus !== 'connected') return;
    
    const startTime = Date.now();
    emitSocketEvent('ping', {}, () => {
      const latency = Date.now() - startTime;
      setSocketLatency(latency);
    });
  };
  
  // Periodically ping the server when connected
  useEffect(() => {
    if (!userState.isJoined || connectionStatus !== 'connected') return;
    
    // Initial ping
    pingServer();
    
    // Ping every 10 seconds
    const pingInterval = setInterval(pingServer, 10000);
    
    return () => clearInterval(pingInterval);
  }, [userState.isJoined, connectionStatus]);

  // Add component to display real-time activity in the room
  const RealTimeActivity = () => {
    if (!userState.isJoined) return null;
    
    return (
      <div className="realtime-activity">
        <h4>Real-time Activity</h4>
        <div className="activity-stats">
          <div className="activity-stat">
            <span className="stat-value">{roomState.userCount}</span>
            <span className="stat-label">Active Users</span>
          </div>
          <div className="activity-stat">
            <span className="stat-value">{recentVotes.length}</span>
            <span className="stat-label">Recent Votes</span>
          </div>
          <div className="activity-stat">
            <span className="stat-value">{connectionStatus === 'connected' ? 'Yes' : 'No'}</span>
            <span className="stat-label">WebSocket Connected</span>
          </div>
          <div className="activity-stat">
            <span className="stat-value">
              {socketLatency ? `${socketLatency}ms` : '-'}
            </span>
            <span className="stat-label">Latency</span>
          </div>
        </div>
        <div className="activity-status">
          <div className={`activity-indicator ${connectionStatus === 'connected' ? 'active' : 'inactive'}`}></div>
          <span>
            {connectionStatus === 'connected' 
              ? 'Real-time updates active' 
              : connectionStatus === 'reconnecting' 
                ? 'Attempting to reconnect...'
                : 'Real-time updates inactive'}
          </span>
        </div>
        <div className="debug-controls">
          <button 
            className={`debug-toggle ${socketDebug ? 'active' : ''}`}
            onClick={toggleSocketDebug}
          >
            {socketDebug ? 'Disable WebSocket Debug' : 'Enable WebSocket Debug'}
          </button>
          <button className="ping-button" onClick={pingServer}>
            Ping Server
          </button>
        </div>
      </div>
    );
  };

  if (!userState.isJoined) {
    return (
      <div className="poll-app">
        {/* <h2>LLUMO Polling App</h2> */}
        
        {notification.isVisible && (
          <div className="notification">
            {notification.message}
          </div>
        )}
        
        {/* <div className="featured-poll">
          <h3>{featuredPoll.question}</h3>
          <div className="featured-options">
            {featuredPoll.options.map(option => {
              const totalVotes = featuredPoll.options.reduce((sum, opt) => sum + opt.votes, 0);
              const percentage = calculatePercentage(option.votes, totalVotes);
              const isSelected = featuredPoll.selectedOption === option.id;
              
              return (
                <div 
                  key={option.id} 
                  className={`featured-option ${featuredPoll.hasVoted ? 'voted' : ''} ${isSelected ? 'selected' : ''}`}
                  onClick={() => handleFeaturedVote(option.id)}
                >
                  <div className="featured-option-content">
                    <span className="option-text">{option.text}</span>
                    {featuredPoll.hasVoted && (
                      <span className="option-percentage">{percentage}%</span>
                    )}
                  </div>
                  {featuredPoll.hasVoted && (
                    <div 
                      className="percentage-bar" 
                      style={{ width: `${percentage}%` }}
                    ></div>
                  )}
                  {isSelected && <div className="selected-indicator">✓</div>}
                </div>
              );
            })}
          </div>
          {featuredPoll.hasVoted && (
            <button className="reset-vote" onClick={resetFeaturedPoll}>
              Vote Again
            </button>
          )}
        </div> */}
        
        <div className="join-form-container">
          <form className="join-form" onSubmit={handleJoinRoom}>
            <h3>Join or Create a Poll Room</h3>
            
            <div className="form-group">
              <label htmlFor="name">Your Name</label>
              <input
                type="text"
                id="name"
                name="name"
                value={userState.name}
                onChange={handleInputChange}
                placeholder="Enter your name"
                required
                minLength="2"
                maxLength="20"
                className={userState.name.length < 2 && userState.name.length > 0 ? 'input-error' : ''}
              />
              {userState.name.length < 2 && userState.name.length > 0 && (
                <div className="input-error-message">Name must be at least 2 characters long</div>
              )}
            </div>
            
            <div className="form-group">
              <label htmlFor="roomCode">Room Code</label>
              <div className="room-code-input-group">
                <input
                  type="text"
                  id="roomCode"
                  name="roomCode"
                  value={userState.roomCode}
                  onChange={handleInputChange}
                  placeholder="Leave empty to create a new room"
                  maxLength="8"
                  className="room-code-input"
                />
                {userState.roomCode && (
                  <button 
                    type="button" 
                    className="clear-room-code"
                    onClick={() => setUserState({...userState, roomCode: ''})}
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
            
            <div className="form-actions">
              <button 
                type="button" 
                className="create-room-btn"
                onClick={() => {
                  if (userState.name.length < 2) {
                    showVoteNotification("Please enter a valid name (at least 2 characters)");
                    return;
                  }
                  setUserState({...userState, roomCode: ''});
                  // Submit the form after state update
                  setTimeout(() => document.querySelector('.join-form').dispatchEvent(
                    new Event('submit', { cancelable: true, bubbles: true })
                  ), 0);
                }}
              >
                Create New Room
              </button>
              <button 
                type="submit" 
                className="join-room-btn"
                disabled={!userState.roomCode || userState.name.length < 2}
              >
                Join Room
              </button>
            </div>
            
            <div className="form-note">
              <p>Note: Voting will be available for 60 seconds after joining a room.</p>
            </div>
            
            {Object.keys(localStorage).some(key => key.startsWith('pollApp_')) && (
              <button type="button" className="clear-storage-btn" onClick={clearAllPersistence}>
                Clear Saved Data
              </button>
            )}
          </form>
          
          {/* Display available rooms for quick join */}
          {availableRooms.length > 0 && (
            <div className="available-rooms-preview">
              <h4>Available Rooms</h4>
              <div className="quick-join-rooms">
                {availableRooms.map(room => (
                  <div key={room.id} className="quick-join-room">
                    <div className="quick-join-info">
                      <span className="room-preview-code">{room.id}</span>
                      <span className="room-preview-users">{room.userCount} users</span>
                    </div>
                    <button 
                      type="button" 
                      className="quick-join-btn"
                      onClick={() => {
                        setUserState({
                          ...userState,
                          roomCode: room.id
                        });
                      }}
                    >
                      Select
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="poll-app">
      <h2>Poll Application</h2>
      
      {notification.isVisible && (
        <div className="notification">
          {notification.message}
        </div>
      )}
      
      <div className="room-info">
        <div className="room-details">
          <span>Room: <strong>{userState.roomCode}</strong></span>
          <span className="room-user-name">Joined as: <strong>{userState.name}</strong></span>
          <span className='room-user-count'>Users online: <strong>{roomState.userCount}</strong></span>
          <span className={`connection-status ${connectionStatus}`}>
            {connectionStatus === 'connected' && 'Connected'}
            {connectionStatus === 'disconnected' && 'Disconnected'}
            {connectionStatus === 'reconnecting' && 'Reconnecting...'}
            {connectionStatus === 'error' && 'Connection Error'}
            {connectionStatus === 'failed' && 'Connection Failed'}
          </span>
          {Object.keys(userVotes).length > 0 && (
            <span className="vote-count">Your votes: <strong>{Object.keys(userVotes).length}</strong></span>
          )}
        </div>
        <div className="timer-container">
          <div className={`countdown-timer ${timer.seconds <= 10 ? 'urgent' : ''} ${timer.votingDisabled ? 'ended' : ''}`}>
            {timer.votingDisabled ? 'Voting Ended' : `Time left: ${formatTime(timer.seconds)}`}
          </div>
          {userState.name === roomState.creator && (
            <button className="reset-timer-btn" onClick={resetTimer}>
              Reset Timer
            </button>
          )}
        </div>
        <div className="action-buttons">
          <button 
            className="reset-votes-btn" 
            onClick={resetAllVotes}
          >
            Reset My Votes
          </button>
          <button 
            className="leave-btn" 
            onClick={handleLeaveRoom}
          >
            Leave Room
          </button>
        </div>
      </div>
      
      {/* <div className="featured-poll">
        <h3>{featuredPoll.question}</h3>
        {timer.votingDisabled && (
          <div className="voting-closed-banner">Voting is closed</div>
        )}
        <div className="featured-options">
          {featuredPoll.options.map(option => {
            const totalVotes = featuredPoll.options.reduce((sum, opt) => sum + opt.votes, 0);
            const percentage = calculatePercentage(option.votes, totalVotes);
            const isSelected = featuredPoll.selectedOption === option.id;
            
            return (
              <div 
                key={option.id} 
                className={`featured-option ${featuredPoll.hasVoted ? 'voted' : ''} ${isSelected ? 'selected' : ''} ${timer.votingDisabled ? 'disabled' : ''}`}
                onClick={() => handleFeaturedVote(option.id)}
              >
                <div className="featured-option-content">
                  <span className="option-text">{option.text}</span>
                  {(featuredPoll.hasVoted || timer.votingDisabled) && (
                    <span className="option-percentage">{percentage}%</span>
                  )}
                </div>
                {(featuredPoll.hasVoted || timer.votingDisabled) && (
                  <div 
                    className="percentage-bar" 
                    style={{ width: `${percentage}%` }}
                  ></div>
                )}
                {isSelected && <div className="selected-indicator">✓</div>}
              </div>
            );
          })}
        </div>
        {featuredPoll.hasVoted && !timer.votingDisabled && (
          <button className="reset-vote" onClick={resetFeaturedPoll}>
            Vote Again
          </button>
        )}
      </div> */}
      
      <div className="polls-container">
        {polls.map(poll => {
          const hasVotedOnThisPoll = userVotes[poll.id] !== undefined;
          const userSelectedOption = userVotes[poll.id];
          
          return (
            <div key={poll.id} className="poll-card">
              <h3>{poll.question}</h3>
              {hasVotedOnThisPoll && (
                <div className="voted-indicator">You voted on this poll</div>
              )}
              {timer.votingDisabled && (
                <div className="voting-closed-banner">Voting is closed</div>
              )}
              <div className="options">
                {poll.options.map(option => {
                  const totalVotes = poll.options.reduce((total, opt) => total + opt.votes, 0);
                  const percentage = calculatePercentage(option.votes, totalVotes);
                  const isUserSelection = userSelectedOption === option.id;
                  
                  return (
                    <div key={option.id} className={`option ${isUserSelection ? 'user-selected' : ''} ${timer.votingDisabled ? 'disabled' : ''}`}>
                      <div className="option-info">
                        <span>{option.text}</span>
                        <span className="votes">{option.votes} votes</span>
                      </div>
                      <div 
                        className="vote-bar" 
                        style={{ 
                          width: `${percentage}%`,
                          opacity: isUserSelection ? '0.4' : '0.2'
                        }}
                      ></div>
                      <button 
                        onClick={() => handleVote(poll.id, option.id)}
                        disabled={hasVotedOnThisPoll || timer.votingDisabled}
                        className={isUserSelection ? 'voted-button' : timer.votingDisabled ? 'disabled-button' : ''}
                      >
                        {isUserSelection ? 'Your Vote' : hasVotedOnThisPoll ? 'Not Allowed' : timer.votingDisabled ? 'Voting Closed' : 'Vote'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="create-poll">
        <h3>Create New Poll</h3>
        <input
          type="text"
          placeholder="Enter your question"
          value={newPoll.question}
          onChange={(e) => setNewPoll({ ...newPoll, question: e.target.value })}
          disabled={timer.votingDisabled}
        />
        
        {newPoll.options.map((option, index) => (
          <input
            key={index}
            type="text"
            placeholder={`Option ${index + 1}`}
            value={option}
            onChange={(e) => handleOptionChange(index, e.target.value)}
            disabled={timer.votingDisabled}
          />
        ))}
        
        <div className="poll-actions">
          <button 
            onClick={addOption} 
            className="add-option"
            disabled={timer.votingDisabled}
          >
            Add Option
          </button>
          <button 
            onClick={handleAddPoll} 
            className="create-btn"
            disabled={timer.votingDisabled}
          >
            Create Poll
          </button>
        </div>
        {timer.votingDisabled && (
          <div className="form-note">
            <p>Poll creation is disabled because voting time has ended.</p>
          </div>
        )}
      </div>

      <RecentVotesDisplay />

      <AvailableRoomsDisplay />

      <RoomUsersDisplay />

      <RealTimeActivity />
    </div>
  );
}

export default PollApp; 