//
//  OpportuniTrackApp.swift
//  OpportuniTrack
//
//  Created by James Shah on 8/21/24.
//

import SwiftUI

@main
struct OpportuniTrackApp: App {
    
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    
    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(Model())
                .preferredColorScheme(.light)
        }
    }
}
