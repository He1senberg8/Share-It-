package org.example.backend.web;

import org.example.backend.model.SignallingMessage;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.handler.annotation.SendTo;
import org.springframework.stereotype.Controller;

@Controller
public class SignallingController {

    @MessageMapping("/signal/{roomId}")
    @SendTo("/topic/room/{roomId}")
    public SignallingMessage relays(@DestinationVariable String roomId , @Payload SignallingMessage message) {
        return message;
    }
}
