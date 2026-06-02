package org.example.backend.model;

public class SignallingMessage {
    private String type ;
    private String sender ;
    private String payload ;
    private String roomId ;

    public SignallingMessage() {
    }

    public SignallingMessage(String type, String sender, String payload, String roomId) {
        this.type = type;
        this.sender = sender;
        this.payload = payload;
        this.roomId = roomId;
    }

    public String getType() {
        return type;
    }

    public void setType(String type) {
        this.type = type;
    }

    public String getSender() {
        return sender;
    }

    public void setSender(String sender) {
        this.sender = sender;
    }

    public String getPayload() {
        return payload;
    }

    public void setPayload(String payload) {
        this.payload = payload;
    }

    public String getRoomId() {
        return roomId;
    }

    public void setRoomId(String roomId) {
        this.roomId = roomId;
    }
}
