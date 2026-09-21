package http

import contractcommon "github.com/example/monorepo/canvas/internal/server/contracts/common"

func pageOutput(pageSize, pageNum int32, total int64) *contractcommon.PageOutput {
	totalPage := int64(0)
	if total > 0 {
		// Page size is already validated; subtract first to avoid overflowing total near MaxInt64.
		totalPage = (total-1)/int64(pageSize) + 1
	}
	return &contractcommon.PageOutput{
		PageSize:  pageSize,
		PageNum:   pageNum,
		Total:     total,
		TotalPage: totalPage,
	}
}
