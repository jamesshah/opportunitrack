//
//  JobApplicationModel.swift
//  OpportuniTrack
//
//  Created by James Shah on 8/30/24.
//

import Foundation

struct JobApplication : Codable, Identifiable {
    
    enum Status : String, Codable, CaseIterable, Identifiable {
        var id: Self { self }
        
        case APPLIED = "APPLIED"
        case IN_PROGRESS = "IN PROGRESS"
        case REJECTED = "REJECTED"
        case OFFERED = "OFFERED"
        
        func getColor() -> String {
            switch self {
            case .APPLIED:
                return "primary"
            case .IN_PROGRESS:
                return "yellow"
            case .REJECTED:
                return "red"
            case .OFFERED:
                return "accent"
            }
        }
        
        static func customSortOrder(_ status: Status) -> Int {
            switch status {
                case .APPLIED:
                    return 0
                case .IN_PROGRESS:
                    return 1
                case .REJECTED:
                    return 2
                case .OFFERED:
                    return 3
            }
        }
    }
    
    enum CodingKeys: String, CodingKey {
        case id, user_id, company_name, job_position, job_status, date
       }
       
    init(id : Int?, user_id: UUID?, company_name: String, job_position: String, job_status: Status, date: Date) {
        self.id = id
        self.user_id = user_id
        self.company_name = company_name
        self.job_position = job_position
        self.job_status = job_status
        self.date = date
    }
    var id: Int?
    var user_id: UUID?
    var company_name: String
    var job_position: String
    var job_status: Status
    var date: Date

    static func getEmptyInstance() -> JobApplication {
        return JobApplication(id: nil, user_id: nil, company_name: "", job_position: "", job_status: Status.APPLIED, date: Date())
    }
    
//    var formattedDate: Date {
//        let dateFormatter = DateFormatter()
//        dateFormatter.dateFormat = "yyyy-MM-dd"
//        return dateFormatter.date(from: dateString) ?? Date()
//    }
}


typealias JobApplications = [JobApplication.Status: [JobApplication]]

extension [JobApplication.Status: [JobApplication]] {
    var sortedKeys : [JobApplication.Status] {
        self.keys.sorted { JobApplication.Status.customSortOrder($0) < JobApplication.Status.customSortOrder($1)}
    }
    
    func sortedValues(filterStatus: JobApplication.Status?) -> [JobApplication] {
        
        return self.values.flatMap{ $0 }
            .filter { app in
                if let filterStatus = filterStatus {
                    return app.job_status == filterStatus
                }
                return true
            }.sorted {$0.date > $1.date}
    }
    
    func getNumberOfApplicationsBy(status: JobApplication.Status, on date:Date) -> Int {
        Array(self.values).flatMap { $0 }.filter { $0.job_status == status && Calendar.current.isDate($0.date, equalTo: date, toGranularity: .day) }.count
    }
}
