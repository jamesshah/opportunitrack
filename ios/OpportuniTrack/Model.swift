//
//  Model.swift
//  OpportuniTrack
//
//  Created by James Shah on 8/21/24.
//

import Foundation
import Supabase
import UserNotifications
import UIKit

@MainActor
class Model: ObservableObject {
    
    @Published var user: User?
    @Published var jobApplications: [JobApplication.Status: [JobApplication]] = [:]
    @Published var backgroundProcess : BackgroundProcess?
    
    let dateFormatter = DateFormatter()
        
    var serverBaseURL: String
    
    var logger = AppLogger()
    
    var supabase: SupabaseClient
    
    init() {
        
        if let configs = Bundle.main.infoDictionary?["Configs"] as? Dictionary<String, String> {            
            supabase = SupabaseClient(
                supabaseURL: URL(string: "https://" + configs["SUPABASE_URL"]!)!,
                supabaseKey: configs["SUPABASE_KEY"]!
            )
            serverBaseURL = "https://" + configs["SERVER_BASE_URL"]!
        } else {
            fatalError("Configs not found")
        }

    }
    
    // MARK: Get User
    func getUser() async throws {
        
        do {
            let currentUser = try await supabase.auth.session.user
            
            let user : User = try await supabase.from("Users")
                .select()
                .eq("user_id", value: currentUser.id)
                .single()
                .execute()
                .value
            
            self.user = user
            print(user)
        } catch AuthError.sessionNotFound {
            print("Supabase session not found")
            throw SupabaseError.userNotFound
        } catch {
            print(error.localizedDescription)
            throw error
        }
    }
    
    // MARK: Update User
    func updateUser(name: String? = nil, grantId: String? = nil, deviceToken: String? = nil) async throws {
        
        var updateData : [String: String] = [:]
        
        if name != nil {
            updateData["name"] = name
        }
        
        if grantId != nil {
            updateData["grant_id"] = grantId
        }
        
        if deviceToken != nil {
            updateData["device_token"] = deviceToken
        }
        
        if updateData.isEmpty {
            print("Please provide either name or grantId or both to update")
            throw SupabaseError.badData
        }
        
        do {
            let currentUser = try await supabase.auth.session.user
            
            try await supabase.from("Users")
                .update(updateData)
                .eq("user_id", value: currentUser.id)
                .execute()
            
            try await getUser()
            
            logger.debug("User updated successfully")
        } catch AuthError.sessionNotFound {
            logger.error("Supabase session not found")
            throw SupabaseError.userNotFound
        } catch {
            logger.error(error.localizedDescription)
            throw error
        }
    }
    
    // MARK: Get Job Applications
    func getJobApplications() async throws {
        do {
            let currentUser = try await supabase.auth.session.user
            
            let response = try await supabase.from("JobApplications")
                .select("id, user_id, company_name, job_position, job_status, date")
                .eq("user_id", value: currentUser.id)
                .order("id", ascending: false)
                .order("date", ascending: false)
                .execute()
                                    
            
            let decoder = JSONDecoder()
            dateFormatter.dateFormat = "yyyy-MM-dd"
            decoder.dateDecodingStrategy = .formatted(dateFormatter)
            
            let jobApplications : [JobApplication] = try decoder.decode([JobApplication].self, from: response.data)
            
            
            let initialGroupedJobApplications = Dictionary(uniqueKeysWithValues: JobApplication.Status.allCases.map { ($0, [JobApplication]()) })
            
            let groupedJobApplications = Dictionary(grouping: jobApplications, by: { $0.job_status })
            
            // Merge the two dictionaries, giving priority to the grouped results.
            self.jobApplications = initialGroupedJobApplications.merging(groupedJobApplications) { (_, new) in new }
            
        } catch AuthError.sessionNotFound {
            logger.error("Supabase session not found")
            throw SupabaseError.userNotFound
        } catch {
            logger.error(error.localizedDescription)
            throw error
        }
    }
    
    // MARK: Get Background Process
    func getBackgroundProcessBy(grantId: String) async throws {
        
        do {
            let backgroundProcess : BackgroundProcess = try await supabase.from("BackgroundProcess")
                .select()
                .single()
                .execute()
                .value
            
            logger.debug("\(backgroundProcess)")
            
            self.backgroundProcess = backgroundProcess
                        
        } catch {
            logger.error(error.localizedDescription)
            throw error
        }
    }
    
    // MARK: Start Background Process
    func startBackgroundProcess(grantId: String) async {
        
        do {
            // Base URL
            var components = URLComponents(string: "\(serverBaseURL)/nylas/start-processing")!
            
            // Query parameters
            components.queryItems = [
                URLQueryItem(name: "grant_id", value: grantId),
            ]
            
            // Get the URL with query parameters
            guard let url = components.url else {
                logger.error("Invalid URL")
                return
            }
            
            // Create the request
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            
            // Optional: Add any headers
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            
            // Create the task
            let (data, _) = try await URLSession.shared.data(for: request)
            
            backgroundProcess = try JSONDecoder().decode(BackgroundProcess.self, from: data)
            logger.debug(backgroundProcess.debugDescription)
                        
        } catch {
            logger.error(error.localizedDescription)
        }
        
        
    }
    
    func checkDeeplink(url : URL) -> DeepLink? {
        guard url.scheme == Bundle.main.bundleIdentifier!.lowercased() else {
            logger.error("Invalid URL: \(url)")
            return nil
        }
                
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: true) else {
            logger.error("Invalid URL : \(url)")
            return nil
        }
        
        print(components.queryItems?.first(where: { queryItem in
            queryItem.name == "grant_id"
        })?.value as Any)
        
        guard let action = components.host else {
            print("Unknown URL : \(url), we can't handle this one!")
            return nil
        }
        
        if (action == DeepLink.loginCallback.rawValue) {
            return DeepLink.loginCallback
        }
        
        if (action == DeepLink.nylasCallback.rawValue) {
            return DeepLink.nylasCallback
        }
        
        return nil
    }

    func getGrantId(from url: URL) -> String? {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: true) else {
            print("Invalid URL : \(url)")
            return nil
        }
        
        return components.queryItems?.first(where: { queryItem in
            queryItem.name == "grant_id"
        })?.value
    }
    
    func requestNotificationAuthorization() {
        let center = UNUserNotificationCenter.current()
        
        center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
            if let error = error {
                print("Authorization error: \(error.localizedDescription)")
            } else {
                if granted {
                    print("Authorization granted")
                    print("Requesting remote notification authorization")
                    DispatchQueue.main.async {
                        // Register for remote notifications if not registered already
                        if !(UIApplication.shared.isRegisteredForRemoteNotifications) {
                            UIApplication.shared.registerForRemoteNotifications()
                        }
                    }

                } else {
                    print("Authorization denied")
                }
            }
        }
    }
}


extension Model {
    static func getPreviewInstance() -> Model {
        let model = Model()
        model.jobApplications = [
            .APPLIED : [
                JobApplication(
                    id: 1,
                    user_id: UUID(uuidString: "1"),
                    company_name: "APPLE",
                    job_position: "Senior Software Engineer",
                    job_status: .APPLIED,
                    date: Date()
                )
            ],
            .IN_PROGRESS : [
                JobApplication(
                    id: 2,
                    user_id: UUID(uuidString: "1"),
                    company_name: "GOOGLE",
                    job_position: "Cloud Engineer",
                    job_status: .IN_PROGRESS,
                    date: Date()
                )
            ],
            .OFFERED : [
                JobApplication(
                    id: 3,
                    user_id: UUID(uuidString: "1"),
                    company_name: "FACEBOOK",
                    job_position: "Machine Learning Engineer",
                    job_status: .OFFERED,
                    date: Date()
                )
            ],
            .REJECTED : [
                JobApplication(
                    id: 4,
                    user_id: UUID(uuidString: "1"),
                    company_name: "NETFLIX",
                    job_position: "Software Engineer (L5)",
                    job_status: .REJECTED,
                    date: Date()
                )
            ]
        ]
        
        model.user = User(name: "Test", user_id: "1", grant_id: "some_grant_id")
        
        model.backgroundProcess = BackgroundProcess(grant_id: "some_grant_id", status: .COMPLETED)
        
        return model
    }
}


// MARK: Models




enum AppError: Error {
    case invalidUrl
}

enum SupabaseError: Error {
    case userNotFound
    case badData
}

enum DeepLink : String {
    case loginCallback = "login-callback"
    case nylasCallback = "nylas-callback"
}
