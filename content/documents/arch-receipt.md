# arch-receipt

## 节点名称

<!-- field:architecture/receipt/title -->
核验真实状态与恢复
<!-- /field -->

## 节点说明

<!-- field:architecture/receipt/description -->
超时先查业务状态，不能直接当成失败重做。有副作用的动作使用幂等标识；部分完成时从检查点恢复或按业务规则补偿。
<!-- /field -->

## 输入

<!-- field:architecture/receipt/input -->
回执、幂等标识、业务状态
<!-- /field -->

## 产出

<!-- field:architecture/receipt/output -->
已完成 / 部分完成 / 失败 / 状态未知
<!-- /field -->
