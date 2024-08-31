//
//  BackgroundProcessModel.swift
//  OpportuniTrack
//
//  Created by James Shah on 8/30/24.
//

import Foundation

struct BackgroundProcess : Codable {
    enum Status : String, Codable {
        case STARTED = "STARTED"
        case RUNNING = "RUNNING"
        case FAILED = "FAILED"
        case COMPLETED = "COMPLETED"
    }
    
    var grant_id: String
    var status: Status
}

