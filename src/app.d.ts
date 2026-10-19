declare global {
	namespace App {
		interface Locals {}
		interface PageData {
			user: {
				email: string;
			};
		}
	}
}

export {};
