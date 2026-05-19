class Solution {
    public boolean isBipartite(int[][] graph) {
        int n = graph.length;
        int[] color = new int[n];

        for (int start = 0; start < n; start++) {
            if (color[start] != 0) continue;

            Queue<Integer> q = new ArrayDeque<>();
            q.offer(start);
            color[start] = 1;

            while (!q.isEmpty()) {
                int cur = q.poll();

                for (int next : graph[cur]) {
                    if (color[next] == 0) {
                        color[next] = -color[cur];
                        q.offer(next);
                    }
                    else if (color[next] == color[cur]) {
                        return false;
                    }
                }
            }
        }

        return true;
    }
}