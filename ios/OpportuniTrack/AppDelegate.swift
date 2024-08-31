//
//  AppDelegate.swift
//  OpportuniTrack
//
//  Created by James Shah on 8/22/24.
//

import Foundation
import UIKit

class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    
    var model = Model()
    
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        // Set the UNUserNotificationCenter delegate
        UNUserNotificationCenter.current().delegate = self

        // Clear the badge number if any
        UNUserNotificationCenter.current().setBadgeCount(0)

        return true
    }
    
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        // Convert device token to string
        let tokenParts = deviceToken.map { data in String(format: "%02.2hhx", data) }
        let deviceTokenString = tokenParts.joined()
        print("Device Token: \(deviceTokenString)")
        
        Task {
            try await model.updateUser(deviceToken: deviceTokenString)
        }
    }
    
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        print("Failed to register for remote notifications: \(error.localizedDescription)")
    }

    // On notification received
    func userNotificationCenter(_: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
//        NotificationHandler.shared.handle(notification: response)
    }


}
