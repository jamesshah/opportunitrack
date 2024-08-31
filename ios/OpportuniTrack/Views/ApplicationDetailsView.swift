//
//  ApplicationDetailsView.swift
//  OpportuniTrack
//
//  Created by James Shah on 8/28/24.
//

import SwiftUI

struct ApplicationDetailsView: View {
    
    @EnvironmentObject var model: Model
    @Environment(\.dismiss) var dismiss
    
    @State var application: JobApplication
    @State var notes: String = ""
    @State var isEditMode : Bool = false
    
    init (application: JobApplication? = nil, isEditMode: Bool = false) {
        if let application = application {
            _application = State(initialValue: application)
        } else {
            _application = State(initialValue: JobApplication.getEmptyInstance())
        }
        
        _isEditMode = State(initialValue: isEditMode)
    }
    
    var isApplicationValid : Bool {
        return !application.company_name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !application.job_position.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
    
    var body: some View {
        NavigationView {
            VStack(alignment: .leading, spacing: 15) {
                
                VStack(alignment: .leading) {
                    Text("Company Name")
                        .font(.headline)
                    TextField("Company Name", text: $application.company_name)
                        .padding(10)
                        .overlay {
                            RoundedRectangle(cornerRadius: 10)
                                .stroke().opacity(0.25)
                        }
                }
                
                VStack(alignment: .leading) {
                    Text("Position")
                        .font(.headline)
                    TextField("Position", text: $application.job_position)
                        .padding(10)
                        .overlay {
                            RoundedRectangle(cornerRadius: 10)
                                .stroke().opacity(0.25)
                        }
                }

                HStack {
                    Text("Current application status")
                        .font(.headline)
                    
                    Spacer()
                    Picker(selection: $application.job_status) {
                        ForEach(JobApplication.Status.allCases) { status in
                            Text(status.rawValue.capitalized)
                        }
                    } label: {
                        Text("Status")
                        Text("Select application status")
                    }
//                    .pickerStyle(.segmented)
                }
                .padding(.bottom, 10)
                
                // TODO: Add notes feature
//                VStack(alignment: .leading) {
//                    
//                    Text("Notes")
//                        .font(.headline)
//                    
//                    TextField("Add notes", text: $notes, axis: .vertical)
//                                .lineLimit(3, reservesSpace: true)
//                                .padding(10)
//                                .overlay {
//                                    RoundedRectangle(cornerRadius: 10)
//                                        .stroke().opacity(0.25)
//                                }
//                }
                
//                Spacer()
                
                HStack {
                    
                    if isEditMode {
                        Button {
                            
                        } label: {
                            Text("Delete")
                                .font(.headline)
                                .padding(8)
                                .frame(maxWidth: .infinity)
                            
                        }
                        .tint(.red)
                        .buttonStyle(BorderedButtonStyle())
                        
                        Spacer()
                    }
                    
                    Button {
                        
                    } label: {
                        Text(isEditMode ? "Update" : "Save")
                            .font(.headline)
                            .padding(8)
                            .frame(maxWidth: .infinity)
                            
                    }
                    .buttonStyle(BorderedProminentButtonStyle())
                }
                
                Spacer()
                Spacer()
                Spacer()
                Spacer()
            }
            .padding()
            .navigationTitle(isEditMode ?  "Edit" : "Add")
            .toolbar {
                ToolbarItemGroup(placement: .navigationBarTrailing) {
                    
//                    Button {
//                        dismiss()
//                    } label: {
//                        Image(systemName: "trash")
//                            .padding(8)
//                            .tint(.red)
//                            .overlay {
//                                Circle()
//                                    .foregroundStyle(.red.secondary.opacity(0.2))
//                            }
//                    }

                    
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .padding(8)
                            .overlay {
                                Circle()
                                    .foregroundStyle(.secondary.opacity(0.2))
                            }
                    }
                    .tint(.secondary)
                    .padding(.trailing)
                }
            }
        }
    }
}

#Preview {
    
    @StateObject var model = Model.getPreviewInstance()
    
    @State var application = model.jobApplications.values.first![0]
    
    return ApplicationDetailsView(application: application, isEditMode: true)
        .environmentObject(model)
}
