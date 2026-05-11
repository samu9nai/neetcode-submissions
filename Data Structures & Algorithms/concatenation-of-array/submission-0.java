class Solution {
    public int[] getConcatenation(int[] nums) {
        int[] doubled = Arrays.copyOf(nums, nums.length * 2);

        System.arraycopy(nums, 0, doubled, nums.length, nums.length);

        return doubled;
    }
}