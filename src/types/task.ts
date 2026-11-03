export interface Task {
  id: string;
  ownerId: string;
  title: string;
  description?: string;
  completed: boolean;
  createdAt: number;
  updatedAt: number;
}
