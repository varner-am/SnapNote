import { HTMLContainer, Rectangle2d, ShapeUtil } from 'tldraw'
import type { SnapPadBucketShape } from './shared'
import { bucketShapeProps } from './shared'

export class BucketShapeUtil extends ShapeUtil<any> {
  static override type = 'snappad-bucket' as const
  static override props = bucketShapeProps

  override canBind() {
    return false
  }

  override canEdit() {
    return false
  }

  override canResize() {
    return false
  }

  override hideRotateHandle() {
    return true
  }

  override getDefaultProps(): SnapPadBucketShape['props'] {
    return {
      w: 280,
      h: 240,
      title: 'Bucket',
      dateLabel: '',
      bucketId: '',
      accent: '#e6c48d',
    }
  }

  override component(shape: SnapPadBucketShape) {
    return (
      <HTMLContainer className="snappad-bucket" style={{ width: shape.props.w, height: shape.props.h }}>
        <div className="snappad-bucket__fill" style={{ ['--accent' as string]: shape.props.accent }}>
          <div className="snappad-bucket__header">
            <span>{shape.props.title}</span>
            <span>{shape.props.dateLabel}</span>
          </div>
        </div>
      </HTMLContainer>
    )
  }

  override indicator(shape: SnapPadBucketShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={24} ry={24} />
  }

  override getGeometry(shape: SnapPadBucketShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
  }
}
