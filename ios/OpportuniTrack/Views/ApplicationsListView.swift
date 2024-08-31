//
//  ApplicationsListView.swift
//  OpportuniTrack
//
//  Created by James Shah on 8/24/24.
//

import SwiftUI

struct ApplicationsListView: View {
    
    @EnvironmentObject var model : Model
    
    @State var searchText: String = ""
    @State var showAddApplication = false
    @State var selectedApplication: JobApplication? = nil
    @State var jobApplications : [JobApplication] = []
    @State var isLoading : Bool = false
    @State var filterStatus : JobApplication.Status?
    
    init(filterStatus: JobApplication.Status? = nil) {
        _filterStatus = State(initialValue: filterStatus)
    }
    
    var navigationTitle : String {
        if let filterStatus = filterStatus {
            return filterStatus.rawValue.capitalized
        }
        return "All applications"
    }
    
//    var sortedApplications: [JobApplication] {
//        return model.jobApplications.values.flatMap{$0}.sorted { $0.date.compare($1.date) ==  .orderedDescending}
//            .sorted {$0.id! > $1.id!}
//    }
    
    
    var body: some View {
        NavigationView {
            ZStack(alignment: .bottomTrailing) {
                
                if jobApplications.isEmpty {
                    Text("No applications yet")
                } else {
                    List {
                        ForEach(jobApplications, id: \.id) { app in
                            ListItem(app: app)
                                .listRowInsets(EdgeInsets())
                                .padding(.vertical, 10)
                                .onTapGesture {
                                    selectedApplication = app
                                }
                        }
                    }
                    .scrollContentBackground(.hidden)
                    .redacted(reason: isLoading ? .placeholder : [])
                    .searchable(text: $searchText, prompt: "Search by Company or Position")
                    .padding(0)
                    .refreshable {
                        isLoading = true
                        jobApplications = model.jobApplications.values.flatMap{ $0 }
                        isLoading = false
                    }
                }
                
                Button {
                    showAddApplication = true
                } label: {
                    Image(systemName: "plus.circle.fill")
                        .font(.system(size: 50))
                }
                .padding([.bottom, .trailing], 25)
            }
            .navigationTitle(navigationTitle)
        }
        .onAppear {
            isLoading = true
            jobApplications = model.jobApplications.sortedValues(filterStatus: filterStatus)
            isLoading = false
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    
                } label: {
                    
                }
            }
        }
        .sheet(item: $selectedApplication) { app in
            ApplicationDetailsView(application: app, isEditMode: true)
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $showAddApplication) {
            ApplicationDetailsView()
                .presentationDragIndicator(.visible)
        }
    }
    
}


extension ApplicationsListView {
    
    struct ListItem : View {
        
        var app: JobApplication
        
        let dateFormatter: DateFormatter = {
            let formatter = DateFormatter()
            formatter.dateStyle = .medium
            return formatter
        }()
        
        
        var body: some View {
            HStack {
                VStack(alignment: .leading) {
                    Text(app.job_position.capitalized)
                        .font(.headline)
                    
                    Text("@ ")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    +
                    Text(app.company_name.capitalized)
                }
                
                Spacer()
                
                VStack(alignment: .trailing) {
                    Text(app.job_status.rawValue.capitalized)
                        .font(.subheadline)
                        .padding(10)
                        .fontWeight(.medium)
                        .overlay {
                            RoundedRectangle(cornerRadius: 10)
                                .stroke(.thinMaterial)
                        }
                    
                    Text(dateFormatter.string(from: app.date))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}

#Preview {
    @StateObject var model = Model.getPreviewInstance()
    
    return ApplicationsListView()
        .environmentObject(model)
}
