"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.MediaTrackHandler = void 0;
/*
Copyright 2023 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

class MediaTrackHandler {
  constructor(pc) {
    this.pc = pc;
  }
  getLocalTracks(kind) {
    const isNotNullAndKind = track => {
      return track !== null && track.kind === kind;
    };
    return this.pc.getTransceivers().filter(t => t.currentDirection === "sendonly" || t.currentDirection === "sendrecv").filter(t => t.sender !== null).map(t => t.sender).map(s => s.track).filter(isNotNullAndKind);
  }
  getTackById(trackId) {
    return this.pc.getTransceivers().map(t => {
      if (t?.sender.track !== null && t.sender.track.id === trackId) {
        return t.sender.track;
      }
      if (t?.receiver.track !== null && t.receiver.track.id === trackId) {
        return t.receiver.track;
      }
      return undefined;
    }).find(t => t !== undefined);
  }
  getLocalTrackIdByMid(mid) {
    const transceiver = this.pc.getTransceivers().find(t => t.mid === mid);
    if (transceiver !== undefined && !!transceiver.sender && !!transceiver.sender.track) {
      return transceiver.sender.track.id;
    }
    return undefined;
  }
  getRemoteTrackIdByMid(mid) {
    const transceiver = this.pc.getTransceivers().find(t => t.mid === mid);
    if (transceiver !== undefined && !!transceiver.receiver && !!transceiver.receiver.track) {
      return transceiver.receiver.track.id;
    }
    return undefined;
  }
  getActiveSimulcastStreams() {
    //@TODO implement this right.. Check how many layer configured
    return 3;
  }
  getTransceiverByTrackId(trackId) {
    return this.pc.getTransceivers().find(t => {
      return t.receiver.track.id === trackId || t.sender.track !== null && t.sender.track.id === trackId;
    });
  }
}
exports.MediaTrackHandler = MediaTrackHandler;