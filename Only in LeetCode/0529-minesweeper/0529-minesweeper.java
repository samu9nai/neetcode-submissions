class Solution {
    int rows;
    int cols;
    int[] dr = {-1, -1, -1, 0, 0, 1, 1, 1};
    int[] dc = {-1, 0, 1, -1, 1, -1, 0, 1};

    public char[][] updateBoard(char[][] board, int[] click) {
        rows = board.length;
        cols = board[0].length;

        int r = click[0];
        int c = click[1];

        if (board[r][c] == 'M') {
            board[r][c] = 'X';
            return board;
        }

        dfs(board, r, c);

        return board;
    }

    private void dfs(char[][] board, int r, int c) {
        if (r < 0 || r >= rows || c < 0 || c >= cols) return;
        
        if (board[r][c] != 'E') return;

        int mines = countAdjacentMines(board, r, c);

        if (mines > 0) {
            board[r][c] = (char) ('0' + mines);
            return;
        }

        board[r][c] = 'B';

        for (int d = 0; d < 8; d++) {
            int nr = r + dr[d];
            int nc = c + dc[d];

            dfs(board, nr, nc);
        }
    }

    private int countAdjacentMines(char[][] board, int r, int c) {
        int count = 0;

        for (int d = 0; d < 8; d++) {
            int nr = r + dr[d];
            int nc = c + dc[d];

            if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;

            if (board[nr][nc] == 'M') count++;
        }

        return count;
    }
}