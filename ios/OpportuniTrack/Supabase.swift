//
//  Supabase.swift
//  OpportuniTrack
//
//  Created by James Shah on 8/21/24.
//

import Foundation
import Supabase
import OSLog

struct AppLogger: SupabaseLogger {
    let logger = Logger(subsystem: Bundle.main.bundleIdentifier!, category: "supabase")

  func log(message: SupabaseLogMessage) {
    switch message.level {
    case .verbose:
      logger.log(level: .info, "\(message.description)")
    case .debug:
      logger.log(level: .debug, "\(message.description)")
    case .warning, .error:
      logger.log(level: .error, "\(message.description)")
    }
  }
}
