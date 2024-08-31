//
//  UserModel.swift
//  OpportuniTrack
//
//  Created by James Shah on 8/30/24.
//

import Foundation

struct User : Codable {
    var name: String
    var user_id: String
    var grant_id: String?
}
