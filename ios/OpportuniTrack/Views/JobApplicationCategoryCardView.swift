//
//  JobApplicationCategoryCardView.swift
//  OpportuniTrack
//
//  Created by James Shah on 8/24/24.
//

import SwiftUI

struct JobApplicationCategoryCardView: View {
    
    var category: String
    var numberOfApplications: Int
    var newApplications: Int?
    var newApplicationsTime: String?
    
    var newApplicationsTimeString: String {
        if let newApplicationsTime = newApplicationsTime {
            if newApplicationsTime == "day" {
                return "today"
            }
            return "this \(newApplicationsTime)"
        } else {
            return "today"
        }
    }
    
    var iconName: String {
        switch category.lowercased() {
        case "applied":
            return "paperplane"
        case "in progress":
            return "person.2"
        case "rejected":
            return "xmark"
        case "offered":
            return "dollarsign"
        default:
            return "info"
        }
    }
    
    var body: some View {
        VStack(alignment:.leading, spacing: 20) {
            Label {
                Text(category)
                    .font(.title2)
                    .fontWeight(.bold)
            } icon: {
                Image(systemName: iconName)
                    .foregroundStyle(.accent)
            }
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Text("\(numberOfApplications)")
                    .font(.title)
                
                if let newApplications = newApplications {
                    Text("+\(newApplications) \(newApplicationsTimeString)")
                        .font(.headline)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
        .cornerRadius(10)
        .overlay(
            RoundedRectangle(cornerRadius: 10)
            .stroke(Color(.sRGB, red: 150/255, green: 150/255, blue: 150/255, opacity: 0.2), lineWidth: 1)
        )
    }
}

#Preview {
    JobApplicationCategoryCardView(category: "Applied", numberOfApplications: 20, newApplications: 5)
        .previewLayout(.sizeThatFits)
}
