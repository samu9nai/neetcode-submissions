class Solution {
    public List<List<Integer>> subsets(int[] nums) {
        List<List<Integer>> answer = new ArrayList<>();
        backtrack(nums, 0, new ArrayList<>(), answer);
        return answer;
    }

    private void backtrack(int[] nums, int start, List<Integer> path, List<List<Integer>> answer) {
        answer.add(new ArrayList<>(path));

        for (int i = start; i < nums.length; i++) {
            path.add(nums[i]);
            backtrack(nums, i + 1, path, answer);
            path.remove(path.size() - 1);
        }
    }
}