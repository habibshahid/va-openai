// DOM Elements
const connectBtn = document.getElementById('connectBtn');
const pushToTalkToggle = document.getElementById('pushToTalkToggle');
const talkBtn = document.getElementById('talkBtn');
const audioToggle = document.getElementById('audioToggle');
const logsToggle = document.getElementById('logsToggle');
const logs = document.getElementById('logs');
const logEntries = document.getElementById('logEntries');
const transcript = document.getElementById('transcript');
const messageInput = document.getElementById('messageInput');
const sendMessageBtn = document.getElementById('sendMessageBtn');
const agentSelect = document.getElementById('agentSelect');
const connectionBadge = document.getElementById('connectionBadge');
const audioStatus = document.getElementById('audioStatus');

// Global variables
let peerConnection = null;
let dataChannel = null;
let audioElement = null;
let sessionStatus = 'DISCONNECTED'; // DISCONNECTED, CONNECTING, CONNECTED
let isPushToTalkActive = false;
let isUserSpeaking = false;
let messageId = 0;

// Agent configurations
const agentConfigs = {
    greeter: {
        name: 'greeter',
        instructions: `You are a friendly greeter who welcomes users and helps them with their day. You should be warm, inviting, and ask if they need any assistance.`,
        tools: []
    },
    customerService: {
        name: 'customerService',
        instructions: `You are a customer service agent for an online store selling snowboarding equipment. You help customers with orders, returns, and product information. Be professional but friendly. Ask for order details when needed.`,
        tools: []
    },
    tourGuide: {
        name: 'tourGuide',
        instructions: `You are an enthusiastic tour guide. You love to share information about local sights and attractions. Be friendly, energetic, and knowledgeable. Offer to answer any questions about the area.`,
        tools: []
    }
};

// Initialize audio element
function initAudioElement() {
    if (!audioElement) {
        console.log('Creating new audio element');
        audioElement = new Audio();
        audioElement.autoplay = audioToggle.checked;
        
        // Add event listeners for debugging
        audioElement.onplay = () => {
            console.log('Audio playback started');
            updateAudioStatus(true, audioElement.muted);
        };
        
        audioElement.onpause = () => {
            console.log('Audio playback paused');
        };
        
        audioElement.onerror = (e) => {
            console.error('Audio error:', e);
            updateAudioStatus(false);
        };
        
        // Append to DOM to ensure it works properly
        audioElement.style.display = 'none';
        document.body.appendChild(audioElement);
    }
}

// Update audio status
function updateAudioStatus(isConnected = false, isMuted = false) {
    if (isConnected) {
        audioStatus.textContent = 'Audio: Connected' + (isMuted ? ' (Muted)' : '');
    } else if (sessionStatus === 'CONNECTING') {
        audioStatus.textContent = 'Audio: Connecting...';
    } else if (sessionStatus === 'CONNECTED') {
        audioStatus.textContent = 'Audio: Waiting for stream';
    } else {
        audioStatus.textContent = 'Audio: Not initialized';
    }
}

// Toggle functions
pushToTalkToggle.addEventListener('change', function() {
    isPushToTalkActive = this.checked;
    talkBtn.disabled = !this.checked || sessionStatus !== 'CONNECTED';
    
    if (sessionStatus === 'CONNECTED') {
        updateSession();
    }
});

audioToggle.addEventListener('change', function() {
    if (audioElement) {
        console.log('Toggling audio playback:', this.checked);
        audioElement.muted = !this.checked;
        
        // Try to play if we're unmuting
        if (this.checked && audioElement.paused && audioElement.srcObject) {
            console.log('Attempting to play audio');
            audioElement.play().catch(err => {
                console.error('Error playing audio:', err);
            });
        }
        
        // Update audio status
        if (sessionStatus === 'CONNECTED') {
            audioStatus.textContent = 'Audio: Connected' + (this.checked ? '' : ' (Muted)');
        }
    }
});

logsToggle.addEventListener('change', function() {
    logs.classList.toggle('hidden', !this.checked);
});

// Agent selection
agentSelect.addEventListener('change', function() {
    if (sessionStatus === 'CONNECTED') {
        updateSession(true);
    }
});

// Connect/Disconnect
connectBtn.addEventListener('click', function() {
    if (sessionStatus === 'CONNECTED' || sessionStatus === 'CONNECTING') {
        disconnectFromRealtime();
    } else {
        connectToRealtime();
    }
});

// Push to talk
talkBtn.addEventListener('mousedown', handleTalkButtonDown);
talkBtn.addEventListener('mouseup', handleTalkButtonUp);
talkBtn.addEventListener('touchstart', handleTalkButtonDown);
talkBtn.addEventListener('touchend', handleTalkButtonUp);

// Text message
sendMessageBtn.addEventListener('click', sendTextMessage);
messageInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && sessionStatus === 'CONNECTED') {
        sendTextMessage();
    }
});

// Log events
function logEvent(direction, eventName, eventData) {
    const logEntry = document.createElement('div');
    logEntry.className = 'log-entry';
    logEntry.dataset.expanded = 'false';
    
    const timestamp = new Date().toLocaleTimeString();
    const arrow = direction === 'client' ? '▲' : '▼';
    const arrowClass = direction === 'client' ? 'client' : 'server';
    
    logEntry.innerHTML = `
        <span class="arrow ${arrowClass}">${arrow}</span>
        <span class="event-name">${eventName}</span>
        <span class="timestamp">${timestamp}</span>
        <div class="log-content">${JSON.stringify(eventData, null, 2)}</div>
    `;
    
    logEntry.addEventListener('click', function() {
        const isExpanded = this.dataset.expanded === 'true';
        this.dataset.expanded = !isExpanded;
        this.classList.toggle('expanded', !isExpanded);
    });
    
    logEntries.appendChild(logEntry);
    logEntries.scrollTop = logEntries.scrollHeight;
}

// Update UI based on session status
function updateUIForSessionStatus() {
    connectBtn.textContent = 
        sessionStatus === 'CONNECTED' ? 'Disconnect' : 
        sessionStatus === 'CONNECTING' ? 'Connecting...' : 'Connect';
    
    connectBtn.classList.toggle('connected', sessionStatus === 'CONNECTED');
    connectBtn.classList.toggle('connecting', sessionStatus === 'CONNECTING');
    
    talkBtn.disabled = !isPushToTalkActive || sessionStatus !== 'CONNECTED';
    sendMessageBtn.disabled = sessionStatus !== 'CONNECTED';
    messageInput.disabled = sessionStatus !== 'CONNECTED';
    
    // Update connection badge
    connectionBadge.textContent = sessionStatus;
    connectionBadge.className = 'badge ' + sessionStatus.toLowerCase();
    
    // Update audio status
    updateAudioStatus(
        sessionStatus === 'CONNECTED' && audioElement && audioElement.srcObject, 
        audioElement && audioElement.muted
    );
}

// Add message to transcript
function addMessage(role, text, isHidden = false) {
    if (isHidden) return;
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}-message`;
    messageDiv.id = `message-${messageId++}`;
    
    const timestamp = document.createElement('div');
    timestamp.className = 'timestamp';
    timestamp.textContent = new Date().toLocaleTimeString();
    
    const content = document.createElement('div');
    content.className = 'content';
    content.textContent = text;
    
    messageDiv.appendChild(timestamp);
    messageDiv.appendChild(content);
    
    transcript.appendChild(messageDiv);
    transcript.scrollTop = transcript.scrollHeight;
    
    return messageDiv.id;
}

// Update message content
function updateMessage(id, text, append = false) {
    const messageDiv = document.getElementById(id);
    if (!messageDiv) return;
    
    const content = messageDiv.querySelector('.content');
    
    if (append) {
        content.textContent += text;
    } else {
        content.textContent = text;
    }
    
    transcript.scrollTop = transcript.scrollHeight;
}

// Fetch session token
async function fetchSessionToken() {
    try {
        console.log('Fetching session token...');
        logEvent('client', 'fetch_session_token_request', { url: '/api/session' });
        
        const response = await fetch('/api/session', {
            method: 'POST'
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            console.error('Server returned an error:', errorData);
            logEvent('client', 'error.session_token_failed', errorData);
            throw new Error(`Failed to get session token: ${errorData.error}`);
        }
        
        const data = await response.json();
        logEvent('client', 'fetch_session_token_response', data);
        
        if (!data.client_secret?.value) {
            logEvent('client', 'error.no_ephemeral_key', data);
            console.error('No ephemeral key provided by the server:', data);
            throw new Error('No ephemeral key provided by the server');
        }
        
        console.log('Session token received');
        return data.client_secret.value;
    } catch (error) {
        console.error('Error fetching session token:', error);
        addMessage('system', `Error: ${error.message}`);
        setSessionStatus('DISCONNECTED');
        return null;
    }
}

// Create WebRTC connection
async function createRealtimeConnection(ephemeralKey) {
    console.log('Creating realtime connection...');
    
    // Create RTCPeerConnection with STUN server
    const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    
    // Set up event handlers for debugging
    pc.oniceconnectionstatechange = () => {
        console.log('ICE connection state:', pc.iceConnectionState);
    };
    
    pc.onsignalingstatechange = () => {
        console.log('Signaling state:', pc.signalingState);
    };
    
    // Handle incoming audio tracks
    pc.ontrack = (event) => {
        console.log('Received track:', event.track.kind);
        
        if (event.track.kind === 'audio') {
            console.log('Received audio track, connecting to audio element');
            
            // Create a MediaStream and add the audio track
            const stream = new MediaStream();
            stream.addTrack(event.track);
            
            // Connect the stream to the audio element
            if (audioElement) {
                audioElement.srcObject = stream;
                
                // Force play the audio - important for browsers that block autoplay
                audioElement.play().catch(err => {
                    console.error('Error playing audio:', err);
                });
                
                console.log('Audio playback set up successfully');
                updateAudioStatus(true, audioElement.muted);
            }
        }
    };
    
    // Get user microphone audio
    try {
        console.log('Requesting microphone access...');
        const mediaStream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            } 
        });
        
        console.log('Microphone access granted');
        
        // Add audio track to the connection
        const audioTrack = mediaStream.getAudioTracks()[0];
        pc.addTrack(audioTrack, mediaStream);
        console.log('Local audio track added to connection');
    } catch (error) {
        console.error('Error accessing microphone:', error);
        addMessage('system', `Error: ${error.message}`);
        throw error;
    }
    
    // Create data channel
    const dc = pc.createDataChannel('oai-events');
    console.log('Data channel created');
    
    // Create and set local description (offer)
    try {
        console.log('Creating SDP offer...');
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        console.log('Local description set');
        
        // Send offer to OpenAI
        console.log('Sending SDP offer to OpenAI...');
        const sdpResponse = await fetch(`https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17`, {
            method: 'POST',
            body: offer.sdp,
            headers: {
                'Authorization': `Bearer ${ephemeralKey}`,
                'Content-Type': 'application/sdp',
            }
        });
        
        if (!sdpResponse.ok) {
            console.error('OpenAI SDP response error:', sdpResponse.status, sdpResponse.statusText);
            const errorText = await sdpResponse.text();
            throw new Error(`OpenAI SDP error: ${sdpResponse.status} - ${errorText}`);
        }
        console.log(sdpResponse)
        // Get and set remote description (answer)
        const answerSdp = await sdpResponse.text();
        console.log('Received SDP answer from OpenAI');
        
        const answer = {
            type: 'answer',
            sdp: answerSdp,
        };
        
        await pc.setRemoteDescription(answer);
        console.log('Remote description set successfully');
        
        return { pc, dc };
    } catch (error) {
        console.error('Error in WebRTC setup:', error);
        throw error;
    }
}

// Connect to OpenAI Realtime
async function connectToRealtime() {
    if (sessionStatus !== 'DISCONNECTED') return;
    
    setSessionStatus('CONNECTING');
    
    try {
        // Initialize audio element
        initAudioElement();
        
        // Get ephemeral key
        const ephemeralKey = await fetchSessionToken();
        if (!ephemeralKey) {
            throw new Error('Failed to get ephemeral key');
        }
        
        // Set up WebRTC connection
        const { pc, dc } = await createRealtimeConnection(ephemeralKey);
        peerConnection = pc;
        dataChannel = dc;
        
        // Set up data channel event handlers
        dc.addEventListener('open', () => {
            console.log('Data channel opened');
            logEvent('client', 'data_channel.open', {});
            
            setSessionStatus('CONNECTED');
            
            // After connection is established, update session
            setTimeout(() => {
                updateSession(true);
            }, 500);
        });
        
        dc.addEventListener('close', () => {
            console.log('Data channel closed');
            logEvent('client', 'data_channel.close', {});
            disconnectFromRealtime();
        });
        
        dc.addEventListener('error', (err) => {
            console.error('Data channel error:', err);
            logEvent('client', 'data_channel.error', { error: err });
        });
        
        dc.addEventListener('message', (e) => {
            try {
                const eventData = JSON.parse(e.data);
                handleServerEvent(eventData);
            } catch (error) {
                console.error('Error handling server message:', error);
            }
        });
        
    } catch (error) {
        console.error('Error connecting to realtime:', error);
        addMessage('system', `Connection error: ${error.message}`);
        setSessionStatus('DISCONNECTED');
    }
}

// Disconnect from OpenAI Realtime
function disconnectFromRealtime() {
    console.log('Disconnecting from realtime...');
    
    if (peerConnection) {
        // Stop all tracks
        peerConnection.getSenders().forEach((sender) => {
            if (sender.track) {
                sender.track.stop();
            }
        });
        
        peerConnection.close();
        peerConnection = null;
    }
    
    // Clean up audio
    if (audioElement) {
        if (audioElement.srcObject) {
            audioElement.srcObject.getTracks().forEach(track => track.stop());
            audioElement.srcObject = null;
        }
        audioElement.pause();
    }
    
    dataChannel = null;
    setSessionStatus('DISCONNECTED');
    isUserSpeaking = false;
    
    logEvent('client', 'disconnected', {});
    console.log('Disconnected from realtime');
}

// Send event to OpenAI
function sendClientEvent(eventObj, eventNameSuffix = '') {
    if (dataChannel && dataChannel.readyState === 'open') {
        const eventName = eventObj.type + (eventNameSuffix ? ` ${eventNameSuffix}` : '');
        console.log('Sending client event:', eventName);
        logEvent('client', eventName, eventObj);
        
        dataChannel.send(JSON.stringify(eventObj));
    } else {
        console.error('Cannot send event - data channel not open:', eventObj);
        logEvent('client', 'error.data_channel_not_open', { attemptedEvent: eventObj.type });
    }
}

// Update session configuration
function updateSession(shouldTriggerResponse = false) {
    console.log('Updating session configuration');
    sendClientEvent({ type: 'input_audio_buffer.clear' }, 'clear audio buffer');
    
    const selectedAgentName = agentSelect.value;
    const currentAgent = agentConfigs[selectedAgentName];
    
    const turnDetection = isPushToTalkActive
        ? null  // No turn detection in push-to-talk mode
        : {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 200,
            create_response: true,
          };
    
    const sessionUpdateEvent = {
        type: 'session.update',
        session: {
            modalities: ['text', 'audio'],
            instructions: currentAgent.instructions,
            voice: 'alloy',  // Valid voices: alloy, echo, fable, onyx, nova, shimmer
            input_audio_format: 'pcm16',
            output_audio_format: 'pcm16',
            input_audio_transcription: { model: 'whisper-1' },
            turn_detection: turnDetection,
            tools: currentAgent.tools || [],
        },
    };
    
    console.log('Sending session update event');
    sendClientEvent(sessionUpdateEvent);
    
    if (shouldTriggerResponse) {
        setTimeout(() => {
            console.log('Sending initial greeting message');
            sendSimulatedUserMessage('hi');
        }, 1000);
    }
}

// Send a text message
function sendTextMessage() {
    const text = messageInput.value.trim();
    if (!text || sessionStatus !== 'CONNECTED') return;
    
    cancelAssistantSpeech();
    
    const id = 'msg-' + Date.now();
    addMessage('user', text);
    
    sendClientEvent({
        type: 'conversation.item.create',
        item: {
            id,
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text }],
        },
    }, 'user text message');
    
    messageInput.value = '';
    
    setTimeout(() => {
        sendClientEvent({ type: 'response.create' }, 'trigger response');
    }, 200);
}

// Send a simulated user message
function sendSimulatedUserMessage(text) {
    const id = 'msg-' + Date.now();
    addMessage('user', text);
    
    console.log('Sending simulated user message:', text);
    
    sendClientEvent({
        type: 'conversation.item.create',
        item: {
            id,
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text }],
        },
    }, 'simulated user message');
    
    setTimeout(() => {
        console.log('Triggering response after simulated message');
        sendClientEvent({ type: 'response.create' }, 'trigger response');
    }, 500);
}

// Handle push-to-talk button press
function handleTalkButtonDown() {
    if (sessionStatus !== 'CONNECTED' || !dataChannel || dataChannel.readyState !== 'open') return;
    
    cancelAssistantSpeech();
    
    isUserSpeaking = true;
    talkBtn.classList.add('active');
    sendClientEvent({ type: 'input_audio_buffer.clear' }, 'clear PTT buffer');
}

// Handle push-to-talk button release
function handleTalkButtonUp() {
    if (sessionStatus !== 'CONNECTED' || !dataChannel || dataChannel.readyState !== 'open' || !isUserSpeaking) return;
    
    isUserSpeaking = false;
    talkBtn.classList.remove('active');
    
    console.log('Committing audio buffer');
    sendClientEvent({ type: 'input_audio_buffer.commit' }, 'commit PTT');
    
    setTimeout(() => {
        console.log('Triggering response after PTT');
        sendClientEvent({ type: 'response.create' }, 'trigger response PTT');
    }, 300);
}

// Cancel current assistant speech
function cancelAssistantSpeech() {
    // Find the most recent assistant message
    const assistantMessages = transcript.querySelectorAll('.assistant-message');
    if (assistantMessages.length === 0) return;
    
    const latestAssistantMessage = assistantMessages[assistantMessages.length - 1];
    const messageId = latestAssistantMessage.id;
    
    console.log('Cancelling assistant speech:', messageId);
    
    sendClientEvent({
        type: 'conversation.item.truncate',
        item_id: messageId.replace('message-', ''),
        content_index: 0,
        audio_end_ms: Date.now() - parseInt(latestAssistantMessage.dataset.createdAt || 0),
    });
    
    sendClientEvent({ type: 'response.cancel' }, 'user interruption');
}

// Update session status
function setSessionStatus(status) {
    console.log('Setting session status:', status);
    sessionStatus = status;
    updateUIForSessionStatus();
    
    if (status === 'CONNECTED') {
        addMessage('system', 'Connected to OpenAI Realtime API');
    } else if (status === 'DISCONNECTED') {
        addMessage('system', 'Disconnected from OpenAI Realtime API');
    }
}

// Handle events from OpenAI
function handleServerEvent(serverEvent) {
    logEvent('server', serverEvent.type, serverEvent);
    console.log('Received server event:', serverEvent);
    switch (serverEvent.type) {
        case 'session.created': {
            if (serverEvent.session?.id) {
                console.log('Session created with ID:', serverEvent.session.id);
                // Don't set status to CONNECTED here - wait for data channel to open
            }
            break;
        }
        
        case 'conversation.item.created': {
            let text = serverEvent.item?.content?.[0]?.text || 
                      serverEvent.item?.content?.[0]?.transcript || '';
            const role = serverEvent.item?.role;
            const itemId = serverEvent.item?.id;
            
            if (itemId && role) {
                if (role === 'user' && !text) {
                    text = '[Transcribing...]';
                }
                
                console.log(`Message created (${role}):`, text);
                
                const messageId = addMessage(role, text);
                if (messageId) {
                    document.getElementById(messageId).dataset.oaiId = itemId;
                    document.getElementById(messageId).dataset.createdAt = Date.now();
                }
            }
            break;
        }
        
        case 'conversation.item.input_audio_transcription.completed': {
            const itemId = serverEvent.item_id;
            const finalTranscript = !serverEvent.transcript || serverEvent.transcript === '\n'
                ? '[inaudible]'
                : serverEvent.transcript;
                
            console.log('Transcription completed:', finalTranscript);
                
            // Find message with matching OpenAI ID
            const messages = Array.from(transcript.querySelectorAll('.message'));
            const message = messages.find(m => m.dataset.oaiId === itemId);
            
            if (message) {
                updateMessage(message.id, finalTranscript, false);
                
                // Important: Explicitly trigger a response after transcription
                setTimeout(() => {
                    console.log('Triggering response after transcription');
                    sendClientEvent({ type: 'response.create' }, 'after transcription');
                }, 300);
            }
            break;
        }
        
        case 'response.audio_transcript.delta': {
            const itemId = serverEvent.item_id;
            const deltaText = serverEvent.delta || '';
            
            // Find message with matching OpenAI ID
            const messages = Array.from(transcript.querySelectorAll('.message'));
            const message = messages.find(m => m.dataset.oaiId === itemId);
            
            if (message) {
                updateMessage(message.id, deltaText, true);
            }
            break;
        }
        
        case 'response.audio.received': {
            console.log('Audio response received');
            updateAudioStatus(true, audioElement ? audioElement.muted : false);
            break;
        }
        
        case 'error': {
            console.error('API error:', serverEvent);
            //addMessage('system', `Error: ${serverEvent.message || 'Unknown error'}`);
            break;
        }
    }
}

// Initialize UI on page load
updateUIForSessionStatus();