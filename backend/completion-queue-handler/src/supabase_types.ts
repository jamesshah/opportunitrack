export type Json =
	| string
	| number
	| boolean
	| null
	| { [key: string]: Json | undefined }
	| Json[];

export type Database = {
	public: {
		Tables: {
			Background_Jobs: {
				Row: {
					created_at: string;
					grant_id: string | null;
					id: number;
					status: string | null;
				};
				Insert: {
					created_at?: string;
					grant_id?: string | null;
					id?: number;
					status?: string | null;
				};
				Update: {
					created_at?: string;
					grant_id?: string | null;
					id?: number;
					status?: string | null;
				};
				Relationships: [
					{
						foreignKeyName: "Background_Jobs_grant_id_fkey";
						columns: ["grant_id"];
						isOneToOne: false;
						referencedRelation: "Users";
						referencedColumns: ["grant_id"];
					}
				];
			};
			JobApplications: {
				Row: {
					company_name: string | null;
					created_at: string;
					date: string | null;
					id: number;
					job_position: string | null;
					job_status: string | null;
					user_id: string;
				};
				Insert: {
					company_name?: string | null;
					created_at?: string;
					date?: string | null;
					id?: number;
					job_position?: string | null;
					job_status?: string | null;
					user_id: string;
				};
				Update: {
					company_name?: string | null;
					created_at?: string;
					date?: string | null;
					id?: number;
					job_position?: string | null;
					job_status?: string | null;
					user_id?: string;
				};
				Relationships: [
					{
						foreignKeyName: "JobApplications_user_id_fkey";
						columns: ["user_id"];
						isOneToOne: false;
						referencedRelation: "Users";
						referencedColumns: ["user_id"];
					}
				];
			};
			Users: {
				Row: {
					created_at: string;
					device_token: string | null;
					grant_id: string | null;
					id: number;
					name: string;
					user_id: string | null;
				};
				Insert: {
					created_at?: string;
					device_token?: string | null;
					grant_id?: string | null;
					id?: number;
					name: string;
					user_id?: string | null;
				};
				Update: {
					created_at?: string;
					device_token?: string | null;
					grant_id?: string | null;
					id?: number;
					name?: string;
					user_id?: string | null;
				};
				Relationships: [
					{
						foreignKeyName: "Users_user_id_fkey";
						columns: ["user_id"];
						isOneToOne: true;
						referencedRelation: "users";
						referencedColumns: ["id"];
					}
				];
			};
		};
		Views: {
			[_ in never]: never;
		};
		Functions: {
			[_ in never]: never;
		};
		Enums: {
			[_ in never]: never;
		};
		CompositeTypes: {
			[_ in never]: never;
		};
	};
};

type PublicSchema = Database[Extract<keyof Database, "public">];

export type Tables<
	PublicTableNameOrOptions extends
		| keyof (PublicSchema["Tables"] & PublicSchema["Views"])
		| { schema: keyof Database },
	TableName extends PublicTableNameOrOptions extends {
		schema: keyof Database;
	}
		? keyof (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
				Database[PublicTableNameOrOptions["schema"]]["Views"])
		: never = never
> = PublicTableNameOrOptions extends { schema: keyof Database }
	? (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
			Database[PublicTableNameOrOptions["schema"]]["Views"])[TableName] extends {
			Row: infer R;
	  }
		? R
		: never
	: PublicTableNameOrOptions extends keyof (PublicSchema["Tables"] &
			PublicSchema["Views"])
	? (PublicSchema["Tables"] &
			PublicSchema["Views"])[PublicTableNameOrOptions] extends {
			Row: infer R;
	  }
		? R
		: never
	: never;

export type TablesInsert<
	PublicTableNameOrOptions extends
		| keyof PublicSchema["Tables"]
		| { schema: keyof Database },
	TableName extends PublicTableNameOrOptions extends {
		schema: keyof Database;
	}
		? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
		: never = never
> = PublicTableNameOrOptions extends { schema: keyof Database }
	? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
			Insert: infer I;
	  }
		? I
		: never
	: PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
	? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
			Insert: infer I;
	  }
		? I
		: never
	: never;

export type TablesUpdate<
	PublicTableNameOrOptions extends
		| keyof PublicSchema["Tables"]
		| { schema: keyof Database },
	TableName extends PublicTableNameOrOptions extends {
		schema: keyof Database;
	}
		? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
		: never = never
> = PublicTableNameOrOptions extends { schema: keyof Database }
	? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
			Update: infer U;
	  }
		? U
		: never
	: PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
	? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
			Update: infer U;
	  }
		? U
		: never
	: never;

export type Enums<
	PublicEnumNameOrOptions extends
		| keyof PublicSchema["Enums"]
		| { schema: keyof Database },
	EnumName extends PublicEnumNameOrOptions extends { schema: keyof Database }
		? keyof Database[PublicEnumNameOrOptions["schema"]]["Enums"]
		: never = never
> = PublicEnumNameOrOptions extends { schema: keyof Database }
	? Database[PublicEnumNameOrOptions["schema"]]["Enums"][EnumName]
	: PublicEnumNameOrOptions extends keyof PublicSchema["Enums"]
	? PublicSchema["Enums"][PublicEnumNameOrOptions]
	: never;
