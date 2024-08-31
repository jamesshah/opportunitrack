//
//  AuthView.swift
//  OpportuniTrack
//
//  Created by James Shah on 8/21/24.
//

import SwiftUI
import Helpers

struct AuthView: View {
    
    @EnvironmentObject var model: Model
    @Environment(\.dismiss) var dismiss
    
    @State var name = ""
    @State var email = ""
    
    var isDataValid : Bool {
        return !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
    
    @State var isLoading = false
    @State var authOpState : AuthOpState = .notStarted
    @State var result: Result<Void, Error>?
    @State var showAlert : Bool = false
    
    var body: some View {
        
        NavigationView {
            Group {
                if isLoading {
                    ProgressView()
                } else {
                    if (authOpState == .completed) {
                        Text("Please check your email to complete sign in!")
                        Spacer()
                    } else {
                        VStack(alignment: .leading, spacing: 20) {
                            FormFields(name: $name, email: $email)
                                .padding(.top, 10)
                            
                            Button {
                                signInButtonTapped()
                            } label: {
                                if (authOpState == .running) {
                                    ProgressView()
                                        .frame(maxWidth: .infinity)
                                        .padding(.vertical, 10)
                                } else {
                                    Text("Sign In")
                                        .frame(maxWidth: .infinity)
                                        .padding(.vertical, 10)
                                }
                            }
                            .disabled(!isDataValid || authOpState == .running)
                            .buttonStyle(BorderedProminentButtonStyle())
                            
                            Spacer()
                        }
                        .padding()
                    }
                }
            }
            .navigationTitle("Get Started")
            .navigationBarBackButtonHidden(true)
        }
        .alert("Something went wrong", isPresented: $showAlert, actions: {
            Button("OK", role: .cancel) {
                authOpState = .notStarted
                dismiss()
            }
        }, message: {
            Text("Please try again!")
        })
        .onOpenURL{ url in
            Task {
                if (model.checkDeeplink(url: url) == DeepLink.loginCallback) {
                    isLoading = true
                    defer {isLoading = false }
                    do {
                        model.logger.debug("Getting session from url!")
                        try await model.supabase.auth.session(from: url)
                    } catch {
                        model.logger.debug("Failed to get sign in user from url: \(error.localizedDescription)")
                        self.authOpState = .failed
                    }
                }
            }
        }
    }
}

extension AuthView {
    
    enum AuthOpState {
        case notStarted
        case running
        case completed
        case failed
    }
    
    struct FormFields : View {
        
        @Binding var name: String
        @Binding var email: String
        
        var body: some View {
            VStack(alignment: .leading) {
                Text("Enter your name")
                TextField("Name", text: $name)
                    .textContentType(.givenName)
                    .autocorrectionDisabled()
                    .padding()
                    .overlay {
                        RoundedRectangle(cornerRadius: 10.0)
                            .stroke(lineWidth: 0.5)
                    }
            }
            
            VStack(alignment: .leading) {
                Text("Enter your email")
                TextField("Email", text: $email)
                    .textContentType(.emailAddress)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .padding()
                    .overlay {
                        RoundedRectangle(cornerRadius: 10.0)
                            .stroke(lineWidth: 0.5)
                    }
            }
        }
    }
    
    func signInButtonTapped() {
        Task {
            authOpState = .running
            
            do {
                try await model.supabase.auth.signInWithOTP(
                    email: email,
                    redirectTo: URL(string: "\(Bundle.main.bundleIdentifier!)://\(DeepLink.loginCallback.rawValue)")!,
                    data: ["name": AnyJSON.string(name)]
                )
                authOpState = .completed
            } catch {
                authOpState = .failed
                showAlert = true
            }
        }
    }
}

#Preview {
    
    @StateObject var model: Model = Model.getPreviewInstance()
    
    return AuthView()
        .environmentObject(model)
}
