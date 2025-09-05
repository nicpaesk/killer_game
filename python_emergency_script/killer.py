import random
import os
import sys
from collections import defaultdict

def load_file(filename):
    """Load content from a file, ignoring empty lines"""
    try:
        with open(filename, 'r', encoding='utf-8') as f:
            return [line.strip() for line in f if line.strip()]
    except FileNotFoundError:
        print(f"Error: File '{filename}' not found.")
        sys.exit(1)
    except Exception as e:
        print(f"Error reading file '{filename}': {e}")
        sys.exit(1)

def assign_targets_and_tasks(players, tasks):
    """Assign random targets and tasks to players with minimized task repetition"""
    if len(players) < 2:
        print("Error: Need at least 2 players.")
        sys.exit(1)
    
    if not tasks:
        print("Error: Need at least one task.")
        sys.exit(1)
    
    # Create a circular assignment for targets
    shuffled_players = players.copy()
    random.shuffle(shuffled_players)
    
    # Assign tasks with minimal repetition
    assignments = {}
    task_counts = defaultdict(int)
    available_tasks = tasks.copy()
    
    for i in range(len(shuffled_players)):
        player = shuffled_players[i]
        target = shuffled_players[(i + 1) % len(shuffled_players)]
        
        # Find the least used task that's available
        if not available_tasks:
            # If all tasks have been used, reset available tasks
            available_tasks = tasks.copy()
        
        # Find the least used tasks among available ones
        min_count = min(task_counts.get(task, 0) for task in available_tasks)
        least_used_tasks = [task for task in available_tasks if task_counts.get(task, 0) == min_count]
        
        # Randomly select from the least used tasks
        task = random.choice(least_used_tasks)
        
        # Update counts and remove task from available if all tasks are used at least once
        task_counts[task] += 1
        if task_counts[task] > 1 and task in available_tasks:
            available_tasks.remove(task)
        
        assignments[player] = {"target": target, "task": task}
    
    return assignments

def display_player_list(players):
    """Display an alphabetically sorted, indexed list of players"""
    sorted_players = sorted(players)
    print("\nPlayer List:")
    print("-" * 30)
    for i, player in enumerate(sorted_players, 1):
        print(f"{i}. {player}")
    print()

def show_assignment(player, assignments):
    """Show the assignment for a specific player"""
    if player in assignments:
        assignment = assignments[player]
        print(f"\n{player}'s target: {assignment['target']}")
        print(f"{player}'s task: {assignment['task']}")
        print("\nPress Enter to continue or type 'quit' to exit...")
    else:
        print("Player not found in assignments.")

def show_all_assignments(assignments):
    """Display all assignments for debugging/checking"""
    print("\n" + "="*60)
    print("ALL ASSIGNMENTS (DEBUG MODE)")
    print("="*60)
    
    # Sort players alphabetically for consistent display
    sorted_players = sorted(assignments.keys())
    
    for player in sorted_players:
        assignment = assignments[player]
        print(f"{player} → Target: {assignment['target']} | Task: {assignment['task']}")
    
    print("="*60)
    print("\nPress Enter to return to the main menu...")

def main():
    if len(sys.argv) != 3:
        print("Usage: python killer_game.py <players_file> <tasks_file>")
        sys.exit(1)
    
    players_file = sys.argv[1]
    tasks_file = sys.argv[2]
    
    # Load data from files
    players = load_file(players_file)
    tasks = load_file(tasks_file)
    
    # Assign targets and tasks
    assignments = assign_targets_and_tasks(players, tasks)
    
    # Main interaction loop
    while True:
        os.system('cls' if os.name == 'nt' else 'clear')  # Clear screen
        
        # Display player list
        display_player_list(players)
        
        # Get user input
        choice = input("Select a player number, or 'quit' to exit: ").strip().lower()
        
        if choice == 'quit':
            break
        elif choice == 'all-debug':
            # Show all assignments in debug mode
            os.system('cls' if os.name == 'nt' else 'clear')
            show_all_assignments(assignments)
            input()  # Wait for user to press Enter
        else:
            # Validate input
            try:
                player_index = int(choice) - 1
                if 0 <= player_index < len(players):
                    selected_player = sorted(players)[player_index]
                    
                    # Clear screen and show assignment
                    os.system('cls' if os.name == 'nt' else 'clear')
                    show_assignment(selected_player, assignments)
                    
                    # Wait for user to continue
                    user_input = input().strip().lower()
                    if user_input == 'quit':
                        break
                else:
                    print("Invalid player number. Press Enter to continue...")
                    input()
            except ValueError:
                print("Please enter a valid number, 'all', or 'quit'. Press Enter to continue...")
                input()

if __name__ == "__main__":
    main()