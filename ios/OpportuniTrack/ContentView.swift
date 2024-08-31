//
//  ContentView.swift
//  OpportuniTrack
//
//  Created by James Shah on 8/21/24.
//

import SwiftUI
import SafariView

struct ContentView: View {
    @EnvironmentObject var model: Model
    @State var authState: AuthState = .loading
    
    var body : some View {
        Group {
            if authState == .loading {
                ProgressView()
            } else if authState == .authenticated {
                TabView {
                    HomeView()
                        .tabItem {
                            Label("Home", systemImage: "house.fill")
                        }
                                        
                    ApplicationsListView()
                        .tabItem {
                            Label("Applications", systemImage: "list.bullet")
                        }
                    
                    SettingsView()
                        .tabItem {
                            Label("Settings", systemImage: "gear")
                        }
                }                
            } else {
                AuthView()                
            }
        }
        .task {
            for await state in model.supabase.auth.authStateChanges {
                if [.initialSession, .signedIn, .signedOut].contains(state.event) {
                    model.logger.debug("\(state.event)")
                    switch state.event {
                        case .initialSession:
                            authState = state.session != nil ? .authenticated : .unauthenticated
                            break
                        case .signedIn:
                            authState = .authenticated
                            break
                        case .signedOut:
                            authState = .unauthenticated
                        default:
                            authState = .unauthenticated
                    }
                }
            }
        }
    }
}

extension ContentView {
    enum AuthState {
        case loading, authenticated, unauthenticated
    }
    
}

#Preview {
    
    @StateObject var model = Model()
    
    return ContentView()
        .environmentObject(model)
}
