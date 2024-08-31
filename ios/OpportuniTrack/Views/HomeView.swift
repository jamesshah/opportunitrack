//
//  HomeView.swift
//  OpportuniTrack
//
//  Created by James Shah on 8/21/24.
//

import SwiftUI
import SafariView

struct HomeView: View {
    
    @EnvironmentObject var model: Model
    @Environment(\.dismiss) var dismiss
    
    @State var showApplicationsForStatus: JobApplication.Status?
    @State var showAddApplication: Bool = false
    @State var showSafari: Bool = false
    @State var isLoading : Bool = true
    @State var showError : Bool = false
    
    let columns = [GridItem(.flexible()), GridItem(.flexible())]
    
    var body: some View {
        
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView()
                } else {
                    ZStack(alignment: .bottomTrailing) {
                        
                        Button {
                            showAddApplication = true
                        } label: {
                            Image(systemName: "plus.circle.fill")
                                .font(.system(size: 50))
                                .foregroundStyle(.accent)
                        }
                        .padding([.bottom, .trailing], 25)
                        
                        VStack(spacing: 25) {
                            LazyVGrid(columns: columns) {
                                ForEach(model.jobApplications.sortedKeys, id:\.hashValue) { status in
                                    
                                    JobApplicationCategoryCardView(category: status.rawValue.capitalized, numberOfApplications: model.jobApplications[status]?.count ?? 0,
                                                                   newApplications: model.jobApplications.getNumberOfApplicationsBy(status: status, on: Date())
                                    )
                                    .onTapGesture {
                                        showApplicationsForStatus = status
                                    }
                                }
                            }
                            
                            EmailIntegrationView(showSafari: $showSafari)
                            
                            Spacer()
                        }
                    }
                }
            }
            .navigationTitle("Overview")
            .padding()
            //            .alert("Something went wrong", isPresented: $showError, actions: {
            //                Button("Cancel", role: .cancel) {
            //                    dismiss()
            //                }
            //            }, message: {
            //                Text("Try again later!")
            //            })
            .sheet(isPresented: $showAddApplication, content: {
                ApplicationDetailsView()
                    .presentationDragIndicator(.visible)
            })
            .sheet(item: $showApplicationsForStatus, content: { status in
                ApplicationsListView(filterStatus: status).presentationDragIndicator(.visible)
            })
            .fullScreenCover(isPresented: $showSafari) {
                let authURL = URL(string: "\(model.serverBaseURL)/nylas/auth")!
                
                SafariView(url: authURL)
            }
            .onAppear {
                model.requestNotificationAuthorization()
            }
            .onOpenURL(perform: { url in
                handleDeepLink(url: url)
            })
            .task {
                print("inside task of HomeView")
                defer {isLoading = false}
                do {
                    try await model.getUser()
                    try await model.getJobApplications()
                    if let grantId = model.user?.grant_id {
                        try await model.getBackgroundProcessBy(grantId: grantId)
                    }
                } catch {
                    if model.user == nil {
                        do {
                            try await model.supabase.auth.signOut()
                        } catch {
                            model.logger.error(error.localizedDescription)
                            showError = true
                        }
                    } else {
                        model.logger.error(error.localizedDescription)
                        showError = true
                    }
                }
            }
        }
    }
}


extension HomeView {
    struct EmailIntegrationView : View {
        
        @EnvironmentObject var model: Model
        @Binding var showSafari: Bool
        
        @State var showLoader: Bool = false
        
        var body: some View {
            if showLoader {
                ProgressView()
            } else if model.user?.grant_id == nil {
                VStack {
                    Button {
                        showSafari = true
                    }label: {
                        Label("Connect your email", systemImage: "envelope")
                            .fontWeight(.medium)
                            .padding(10)
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(BorderedProminentButtonStyle())
                    
                    Label("We only access job application related emails!", systemImage: "lock.fill")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                
            } else if let process = model.backgroundProcess{
                switch process.status {
                case .STARTED, .RUNNING:
                    VStack(alignment: .center) {
                        Label("We are analyzing your emails!", systemImage: "envelope.open.badge.clock")
                            .font(.headline)
                        Text("We'll notify you once this is done!")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    
                case .FAILED:
                    Label("We are analyzing your emails!", systemImage: "hourglass")
                    
                case .COMPLETED:
                    
                    Label("Your email is connected!", systemImage: "checkmark.circle.fill")
                        .font(.headline)
                        .foregroundStyle(.accent)
                }
            } else {
                Text("We faced an error anlayzing your emails!")
                    .foregroundStyle(.red)
                    .padding(.vertical)
                    .padding(.horizontal, 1.25)
                    .frame(maxWidth: .infinity)
                    .overlay{
                        RoundedRectangle(cornerRadius: 10)
                            .stroke(.red, lineWidth: 1.0)
                    }
                Button {
                    showLoader = true
                    Task {
                        await model.startBackgroundProcess(grantId: (model.user?.grant_id)!)
                        showLoader = false
                    }
                } label: {
                    Label("Please try again", systemImage: "arrow.counterclockwise")
                }
            }
        }
    }
    
    
    func handleDeepLink(url: URL) -> Void {
        if (model.user != nil) {
            print("App was opened via URL: \(url)")
            if (model.checkDeeplink(url: url) == DeepLink.nylasCallback) {
                isLoading = true
                showSafari = false
                
                guard let grantId = model.getGrantId(from: url) else {
                    showError = true
                    return
                }
                
                Task {
                    do {
                        try await model.updateUser(grantId: grantId)
                        
                        await model.startBackgroundProcess(grantId: grantId)
                        
                        //                        try await model.getBackgroundProcessBy(grantId: grantId)
                        model.requestNotificationAuthorization()
                    } catch {
                        model.logger.error(error.localizedDescription)
                        isLoading = false
                        showError = true
                    }
                    isLoading = false
                }
            }
        } else {
            Task {
                try await model.supabase.auth.signOut()
            }
        }
    }
}

#Preview {
    
    @StateObject var model = Model.getPreviewInstance()
    
    return HomeView()
        .environmentObject(model)
}
