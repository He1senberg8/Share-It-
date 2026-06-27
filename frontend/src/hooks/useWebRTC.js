import React , {useRef , useState , useEffect, useCallback } from 'react'

const WEBRTC_CONFIG = {
    iceServers : [{urls : 'stun:stun.l.google.com:19302'}]
};
const usewebRTC = (sendSignal) => {
    const peerConnection = useRef(null) ; 
    const dataChannel = useRef(null) ;

    const [connectionState , setConnectionState] = useState('disconnected') ; 
    const [receivedMessages , setReceivedMessages ] = useState([]) ; 

    const initializePeer = useCallback(() => {
        if ( peerConnection.current ) return ; 

        const pc = new RTCPeerConnection(WEBRTC_CONFIG) ;
        peerConnection.current = pc ; 

        pc.onicecandidate = (event) => {
            if ( event.candidate ) {
                sendSignal({
                    type:'ICE_CANDIDATE' ,
                    payload: JSON.stringify(event.candidate)
                });
            }
        }

        pc.oniceconnectionstatechange = () => {
            setConnectionState(pc.iceConnectionState) ;
            console.log("State changed to : ", pc.iceConnectionState);
        }

        pc.ondatachannel = (event) => {
            const channel = event.channel 
            setupDataChannelEvents(channel) ;
            dataChannel.current = channel ; 
        }

        return pc ; 
    } , [sendSignal])

    const setupDataChannelEvents = (channel) => {
        channel.onopen = () => console.log("Direct P2P channel opened")
        channel.onclose = () => console.log("P2P channel closed")
        channel.onmessage = (event) => {
            setReceivedMessages((prev) => [...prev,`Peer: ${event.data}`])
        };
    };

    const initiateCall = async() => {
        const pc = initializePeer() ;
        
        const channel = pc.createDataChannel('file-share-channel')
        setupDataChannelEvents(channel) ;
        dataChannel.current = channel ;

        const offer = await pc.createOffer() ;
        await pc.setLocalDescription(offer) ;
        sendSignal({
            type:'OFFER' ,
            payload: JSON.stringify(offer)
        });
    }

    const processIncomingSignal = async (signal) => {
        const pc = peerConnection.current || initializePeer() ; 
        const data = JSON.parse(signal.payload) ;

        try {
            if ( signal.type === 'OFFER' ) {
                await pc.setRemoteDescription(new RTCSessionDescription(data)) ;
                const answer = await pc.createAnswer() ;
                await pc.setLocalDescription(answer) ;

                sendSignal({
                    type: 'ANSWER' ,
                    payload: JSON.stringify(answer)
                })
            } else if ( signal.type === 'ANSWER' ) {
                await pc.setRemoteDescription(new RTCSessionDescription(data)) ;
            } else if (signal.type === 'ICE_CANDIDATE') {
                await pc.addIceCandidate(new RTCIceCandidate(data)) ;
            }
        } catch (error) {
            console.error("Error processing WebRtc Signal " , error)
        }
    }

    const sendDirectMessage = (text) => {
        if ( dataChannel.current && dataChannel.current.readyState === 'open') {
            dataChannel.current.send(text) ;
            setReceivedMessages((prev) => [...prev , `Me: ${text}`])
        } else {
            console.log("Data Channel is not open yet ")
        }
    };

    return {
        initiateCall ,
        processIncomingSignal ,
        sendDirectMessage ,
        receivedMessages ,
        connectionState
    }
}

export default usewebRTC
